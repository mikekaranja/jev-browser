import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { askJev, InvalidJevAnswer, resolveTransport } from "../dist/provider.js";
import { navigate } from "../dist/library.js";

const signal = new AbortController().signal;
const questions = { item: { type: "choice", criteria: { alpha: "A", beta: "B" } }, yes: { type: "noul" } };
const answers = { item: { type: "choice", choice: "beta", probabilities: { alpha: 0.2, beta: 0.8 } }, yes: { type: "noul", noul: 0.7 } };
const input = { state: { title: "Example" }, questions, model: "jev-latest", signal };
const usage = { input_tokens: 13, output_tokens: 3 };
const carrier = (override = {}) => ({ name: "fixture", ask: async () => ({ answers, usage, model: "effective", ...override }) });
const builtin = (name, env) => resolveTransport({ ...env, JEV_PROVIDER: name });

async function withFetch(fn, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test("registry auto-detects in precedence order and explicit names select only themselves", () => {
  const all = { TYPESAFE_API_KEY: "ts-secret", OPENROUTER_API_KEY: "sk-or-secret", CLOUDFLARE_API_TOKEN: "cf-secret", CLOUDFLARE_ACCOUNT_ID: "account", AI_GATEWAY_API_KEY: "ai-secret" };
  for (const [removed, expected] of [
    [[], "typesafe"],
    [["TYPESAFE_API_KEY"], "openrouter"],
    [["TYPESAFE_API_KEY", "OPENROUTER_API_KEY"], "cloudflare"],
    [["TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "CLOUDFLARE_API_TOKEN"], "vercel"],
  ]) {
    const env = { ...all };
    for (const key of removed) delete env[key];
    assert.equal(resolveTransport(env).name, expected);
  }
  for (const name of ["typesafe", "openrouter", "cloudflare", "vercel"]) {
    assert.equal(resolveTransport({ ...all, JEV_PROVIDER: name.toUpperCase() }).name, name);
  }
  assert.equal(resolveTransport({ JEV_CLOUDFLARE_API_TOKEN: "pref", CLOUDFLARE_ACCOUNT_ID: "account" }).name, "cloudflare");
  assert.throws(() => resolveTransport({ ...all, JEV_PROVIDER: "typo" }), /Unknown JEV_PROVIDER/);
  assert.throws(() => resolveTransport({}), (error) => ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "CLOUDFLARE_API_TOKEN", "JEV_CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "AI_GATEWAY_API_KEY"].every((name) => error.message.includes(name)));
});

test("forced credentials reject every missing or invalid variant without leaking values", () => {
  const cases = [
    ["typesafe", {}, /TYPESAFE_API_KEY/],
    ["openrouter", {}, /OPENROUTER_API_KEY/],
    ["openrouter", { OPENROUTER_API_KEY: "wrong-secret" }, /sk-or-/],
    ["cloudflare", {}, /CLOUDFLARE_ACCOUNT_ID/],
    ["cloudflare", { CLOUDFLARE_API_TOKEN: "cf-secret" }, /CLOUDFLARE_ACCOUNT_ID/],
    ["cloudflare", { CLOUDFLARE_ACCOUNT_ID: "account-secret" }, /CLOUDFLARE_API_TOKEN/],
    ["cloudflare", { JEV_CLOUDFLARE_API_TOKEN: "cf-secret" }, /CLOUDFLARE_ACCOUNT_ID/],
    ["vercel", {}, /AI_GATEWAY_API_KEY/],
  ];
  for (const [name, env, pattern] of cases) {
    assert.throws(() => resolveTransport({ ...env, JEV_PROVIDER: name }), (error) => {
      assert.match(error.message, pattern);
      assert.ok(error.message.startsWith(`JEV_PROVIDER=${name}`));
      assert.ok(!error.message.includes("secret"));
      return true;
    });
  }
  assert.equal(resolveTransport({ OPENROUTER_API_KEY: "wrong-secret", AI_GATEWAY_API_KEY: "ai-secret" }).name, "vercel");
  assert.equal(resolveTransport({ CLOUDFLARE_ACCOUNT_ID: "account-secret", AI_GATEWAY_API_KEY: "ai-secret" }).name, "vercel");
});

test("facade validates the complete answer contract before usage can be credited", async () => {
  const good = await askJev(carrier(), input);
  assert.equal(good.provider, "fixture");
  assert.equal(good.answers.item.confidence, null);
  assert.equal(good.model, "effective");
  for (const [mutated, id, reason] of [
    [{ item: answers.item }, "yes", /missing answer/],
    [{ ...answers, item: { ...answers.item, type: "noul" } }, "item", /wrong type/],
    [{ ...answers, item: { ...answers.item, choice: "gamma" } }, "item", /outside criteria/],
    [{ ...answers, item: { ...answers.item, choice: "alpha" } }, "item", /not a distribution maximum/],
    [{ ...answers, item: { ...answers.item, probabilities: { alpha: NaN, beta: 0.8 } } }, "item", /finite probabilities/],
    [{ ...answers, item: { ...answers.item, probabilities: { alpha: 0.1, beta: 0.7 } } }, "item", /approximately 1/],
    [{ ...answers, item: { ...answers.item, probabilities: { alpha: 0.2, beta: 0.7, extra: 0.1 } } }, "item", /exactly the criteria/],
    [{ ...answers, item: { ...answers.item, confidence: Infinity } }, "item", /confidence/],
    [{ ...answers, yes: { type: "noul", noul: 1.1 } }, "yes", /noul/],
  ]) {
    await assert.rejects(() => askJev(carrier({ answers: mutated }), input), (error) => error instanceof InvalidJevAnswer && error.message.includes(`provider fixture question ${id}`) && reason.test(error.message));
  }
  await assert.rejects(() => askJev(carrier({ usage: { input_tokens: -1, output_tokens: 0 } }), input), /provider fixture question <response>.*usage/);
  await assert.rejects(() => askJev(carrier({ usage: { input_tokens: undefined, output_tokens: 0 } }), input), /provider fixture question <response>.*usage/);
  await assert.rejects(() => askJev(carrier({ model: " " }), input), /provider fixture question <response>.*model/);
  const tied = { ...answers, item: { ...answers.item, choice: "alpha", probabilities: { alpha: 0.4995, beta: 0.5005 }, confidence: 0 } };
  assert.equal((await askJev(carrier({ answers: tied }), input)).answers.item.choice, "alpha");
  const score = { state: null, model: "jev", signal, questions: { rank: { type: "score", criteria: ["poor", "good", "great"] } } };
  const scoreReply = { rank: { type: "score", score: 2, probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 }, confidence: null } };
  assert.equal((await askJev(carrier({ answers: scoreReply }), score)).answers.rank.score, 2);
  await assert.rejects(() => askJev(carrier({ answers: { rank: { ...scoreReply.rank, score: 3 } } }), score), /question rank.*score is outside/);
});

test("transport failure stays distinct from invalid answers and cancellation keeps its reason", async () => {
  const failed = { name: "fixture", ask: async () => { throw new Error("body-secret"); } };
  await assert.rejects(() => askJev(failed, input), (error) => !(error instanceof InvalidJevAnswer) && /request failed/.test(error.message) && !/body-secret/.test(error.message));

  const controller = new AbortController();
  const reason = new Error("deadline-exceeded");
  const cancelled = { name: "fixture", ask: async () => { controller.abort(reason); throw reason; } };
  await assert.rejects(() => askJev(cancelled, { ...input, signal: controller.signal }), (error) => error === reason);
});

test("TypeSafe client binds key and base URL at creation, forwards request and cancellation", async () => {
  const calls = [];
  await withFetch(async (url, init) => {
    calls.push({ url, init });
    return Response.json({ answers, usage });
  }, async () => {
    const transport = builtin("typesafe", { TYPESAFE_API_KEY: "ts-secret", TYPESAFE_BASE_URL: "https://local.typesafe.test" });
    const reply = await askJev(transport, input);
    assert.deepEqual(reply.usage, usage);
    assert.equal(reply.model, "jev-latest");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://local.typesafe.test/v1/systemone");
    assert.equal(calls[0].init.headers.Authorization, "Bearer ts-secret");
    assert.deepEqual(JSON.parse(calls[0].init.body), { state: input.state, questions, model: "jev-latest" });
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.equal(calls[0].init.signal.aborted, false);
  });
  await withFetch(async () => Response.json({ error: "body-secret" }, { status: 400 }), async () => {
    await assert.rejects(() => askJev(builtin("typesafe", { TYPESAFE_API_KEY: "ts-secret" }), input), (error) => !/body-secret|ts-secret/.test(error.message) && /request failed/.test(error.message) && !(error instanceof InvalidJevAnswer));
  });
});

test("OpenRouter maps latest and pinned slugs, sends exact envelope and redacts HTTP errors", async () => {
  const calls = [];
  await withFetch(async (url, init) => {
    calls.push({ url, init });
    return Response.json(calls.length === 1 ? { answers, usage, model: "typesafe/jev-1.13-20260917" } : { answers, usage });
  }, async () => {
    const transport = builtin("openrouter", { OPENROUTER_API_KEY: "sk-or-secret" });
    assert.equal((await askJev(transport, input)).model, "typesafe/jev-1.13-20260917");
    assert.equal((await askJev(transport, { ...input, model: "typesafe/jev-1.12" })).model, "typesafe/jev-1.12");
    assert.equal((await askJev(transport, { ...input, model: "~typesafe/jev-latest" })).model, "~typesafe/jev-latest");
    assert.equal(calls[0].url, "https://openrouter.ai/api/alpha/decisions");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(calls[0].init.headers, { Authorization: "Bearer sk-or-secret", "Content-Type": "application/json", "HTTP-Referer": "https://github.com/jkudish/jev-browser", "X-Title": "jev-browser", "X-OpenRouter-Title": "jev-browser" });
    assert.equal(calls[0].init.signal, signal);
    assert.deepEqual(JSON.parse(calls[0].init.body), { model: "~typesafe/jev-latest", state: input.state, questions });
    assert.deepEqual(calls.map((call) => JSON.parse(call.init.body).model), ["~typesafe/jev-latest", "typesafe/jev-1.12", "~typesafe/jev-latest"]);
  });
  for (const response of [new Response("body-secret", { status: 403 }), new Response("body-secret", { status: 200 })]) {
    await withFetch(async () => response, async () => {
      await assert.rejects(() => askJev(builtin("openrouter", { OPENROUTER_API_KEY: "sk-or-secret" }), input), (error) => /request failed/.test(error.message) && !/body-secret|sk-or-secret/.test(error.message));
    });
  }
  await withFetch(async () => Response.json({ usage }), async () => {
    await assert.rejects(() => askJev(builtin("openrouter", { OPENROUTER_API_KEY: "sk-or-secret" }), input), /question <response>.*answers/);
  });
  await withFetch(async () => { throw new Error("body-secret sk-or-secret"); }, async () => {
    await assert.rejects(() => askJev(builtin("openrouter", { OPENROUTER_API_KEY: "sk-or-secret" }), input), (error) => /request failed/.test(error.message) && !/body-secret|sk-or-secret/.test(error.message) && !(error instanceof InvalidJevAnswer));
  });
});

test("Cloudflare token priority, double envelope, state, usage, and safe errors", async () => {
  const calls = [];
  const env = { CLOUDFLARE_API_TOKEN: "low-secret", JEV_CLOUDFLARE_API_TOKEN: "high-secret", CLOUDFLARE_ACCOUNT_ID: "account" };
  await withFetch(async (url, init) => {
    calls.push({ url, init });
    return Response.json({ success: true, result: { state: "Completed", result: { answers, usage, model: "typesafe/jev" } } });
  }, async () => {
    const transport = builtin("cloudflare", env);
    assert.deepEqual((await askJev(transport, input)).usage, usage);
    assert.equal(calls[0].url, "https://api.cloudflare.com/client/v4/accounts/account/ai/run");
    assert.deepEqual(calls[0].init.headers, { Authorization: "Bearer high-secret", "Content-Type": "application/json" });
    assert.equal(calls[0].init.signal, signal);
    assert.deepEqual(JSON.parse(calls[0].init.body), { model: "typesafe/jev", input: { state: input.state, questions } });
    assert.equal((await transport.ask({ ...input, model: "typesafe/jev-1.2" })).model, "typesafe/jev");
    assert.equal(JSON.parse(calls[1].init.body).model, "typesafe/jev-1.2");
  });
  for (const response of [new Response("body-secret", { status: 401 }), Response.json({ success: false, errors: ["body-secret"] }), Response.json({ result: { state: "Failed body-secret" } }), new Response("body-secret", { status: 200 })]) {
    await withFetch(async () => response, async () => {
      await assert.rejects(() => askJev(builtin("cloudflare", env), input), (error) => /request failed/.test(error.message) && !/body-secret|high-secret|low-secret/.test(error.message));
    });
  }
  await withFetch(async () => { throw new Error("body-secret high-secret"); }, async () => {
    await assert.rejects(() => askJev(builtin("cloudflare", env), input), (error) => /request failed/.test(error.message) && !/body-secret|high-secret/.test(error.message) && !(error instanceof InvalidJevAnswer));
  });
});

test("Vercel forwards evaluation request and adapts boolean and confidence", async () => {
  let call;
  const raw = { item: { type: "choice", choice: "beta", probabilities: { alpha: 0.2, beta: 0.8 } }, yes: { type: "boolean", probability: 0.7 } };
  const result = { answers: raw, usage: { inputTokens: 13, outputTokens: 3 }, providerMetadata: { typesafe: { confidence: { item: 0.92 } } } };
  const transport = builtin("vercel", { AI_GATEWAY_API_KEY: "ai-secret" });
  await withFetch(async (url, init) => { call = { url, init }; return Response.json(result); }, async () => {
    const reply = await askJev(transport, input);
    assert.equal(reply.model, "typesafe-ai/jev");
    assert.deepEqual(reply.usage, usage);
    assert.equal(call.url, "https://ai-gateway.vercel.sh/v4/ai/evaluation-model");
    assert.equal(call.init.signal, signal);
    assert.equal(call.init.headers.Authorization, "Bearer ai-secret");
    assert.equal(call.init.headers["ai-model-id"], "typesafe-ai/jev");
    assert.deepEqual(JSON.parse(call.init.body), { state: input.state, questions: { item: { type: "choice", criteria: questions.item.criteria }, yes: { type: "boolean" } } });
    assert.deepEqual(reply.answers, { item: { ...answers.item, confidence: 0.92 }, yes: answers.yes });
  });
  await withFetch(async () => Response.json({ ...result, answers: { item: raw.item } }), async () => {
    await assert.rejects(() => askJev(transport, input), (error) => error instanceof InvalidJevAnswer && /question yes.*missing answer/.test(error.message));
  });
  await withFetch(async () => new Response("body-secret", { status: 403 }), async () => {
    await assert.rejects(() => askJev(transport, input), (error) => !(error instanceof InvalidJevAnswer) && /request failed/.test(error.message) && !/body-secret|ai-secret/.test(error.message));
  });
});

test("all adapters distinguish absent usage from malformed containers and present null counters", async () => {
  const vercelAnswers = { item: answers.item, yes: { type: "boolean", probability: answers.yes.noul } };
  for (const [name, field, run] of [
    ["typesafe", "input_tokens", (wire) => withFetch(async () => Response.json({ answers, ...wire }), () => askJev(builtin("typesafe", { TYPESAFE_API_KEY: "ts-secret" }), input))],
    ["openrouter", "input_tokens", (wire) => withFetch(async () => Response.json({ answers, ...wire }), () => askJev(builtin("openrouter", { OPENROUTER_API_KEY: "sk-or-secret" }), input))],
    ["cloudflare", "input_tokens", (wire) => withFetch(async () => Response.json({ result: { state: "Completed", result: { answers, ...wire } } }), () => askJev(builtin("cloudflare", { CLOUDFLARE_API_TOKEN: "cf-secret", CLOUDFLARE_ACCOUNT_ID: "account" }), input))],
    ["vercel", "inputTokens", (wire) => withFetch(async () => Response.json({ answers: vercelAnswers, ...wire }), () => askJev(builtin("vercel", { AI_GATEWAY_API_KEY: "ai-secret" }), input))],
  ]) {
    assert.deepEqual((await run({})).usage, { input_tokens: 0, output_tokens: 0 }, name);
    assert.deepEqual((await run({ usage: {} })).usage, { input_tokens: 0, output_tokens: 0 }, name);
    const invalidCases = [{ usage: "body-secret" }, { usage: null }, { usage: { [field]: null } }];
    for (const invalid of invalidCases) {
      await assert.rejects(() => run(invalid), (error) => /usage|request failed/.test(error.message) && !error.message.includes("body-secret"), `${name}: ${JSON.stringify(invalid)}`);
    }
  }
});

test("injected transport drives both call sites and malformed second-stage answer executes nothing", async (t) => {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (String(error).includes("Executable doesn't exist")) {
      t.skip("Playwright browser binary is not installed");
      return;
    }
    throw error;
  }
  try {
    const page = await browser.newPage();
    await page.setContent('<label for="tier">Tier</label><select id="tier"><option value="a">Basic</option><option value="b">Premium</option></select>');
    for (const broken of [false, true]) {
      const calls = [];
      const transport = {
        name: "custom-carrier",
        async ask(request) {
          calls.push(request);
          const reply = request.questions.option
            ? { option: broken ? { type: "choice", choice: "missing", probabilities: { o0: 0.1, o1: 0.9 } } : { type: "choice", choice: "o1", probabilities: { o0: 0.1, o1: 0.9 } } }
            : { action: { type: "choice", choice: "select_e1", probabilities: Object.fromEntries(Object.keys(request.questions.action.criteria).map((key) => [key, key === "select_e1" ? 1 : 0])) }, goal_done: { type: "noul", noul: 0 }, stuck: { type: "noul", noul: 0 } };
          return { answers: reply, usage, model: "custom-model" };
        },
      };
      const previous = process.env.JEV_PROVIDER;
      process.env.JEV_PROVIDER = "invalid-forced-name";
      let result;
      try { result = await navigate({ task: "Choose Premium", page, transport, allowTyping: false, maxSteps: 1, screenshot: "none" }); }
      finally { if (previous === undefined) delete process.env.JEV_PROVIDER; else process.env.JEV_PROVIDER = previous; }
      assert.equal(calls.length, 2);
      assert.equal(result.jev_provider, "custom-carrier");
      assert.equal(result.model, "custom-model");
      if (broken) {
        assert.equal(result.status, "error");
        assert.match(result.error, /question option.*outside criteria/);
        assert.equal(result.usage.jev_calls, 1);
        assert.equal(result.steps.length, 0);
        assert.equal(await page.locator("select").inputValue(), "a");
      } else {
        assert.equal(result.status, "max_steps");
        assert.equal(result.usage.jev_calls, 2);
        assert.equal(result.steps[0].executed_action, "select_e1");
        assert.equal(await page.locator("select").inputValue(), "b");
        await page.locator("select").selectOption("a");
      }
    }
    const refused = await navigate({
      task: "Choose Premium", page, allowTyping: false, maxSteps: 1, screenshot: "none",
      transport: { name: "custom-carrier", async ask(request) {
        if (request.questions.option) throw new Error("body-secret");
        return { answers: { action: { type: "choice", choice: "select_e1", probabilities: Object.fromEntries(Object.keys(request.questions.action.criteria).map((key) => [key, key === "select_e1" ? 1 : 0])) }, goal_done: { type: "noul", noul: 0 }, stuck: { type: "noul", noul: 0 } }, usage, model: "custom-model" };
      } },
    });
    assert.equal(refused.status, "error");
    assert.match(refused.error, /question option: request failed/);
    assert.ok(!refused.error.includes("body-secret"));
    assert.equal(refused.steps.length, 0);
    assert.equal(await page.locator("select").inputValue(), "a");
    const primary = await navigate({
      task: "Choose Premium", page, allowTyping: false, maxSteps: 1, screenshot: "none",
      transport: { name: "custom-carrier", ask: async () => ({ answers: { action: { type: "choice", choice: "select_e1", probabilities: {} } }, usage, model: "custom-model" }) },
    });
    assert.equal(primary.status, "error");
    assert.match(primary.error, /question goal_done.*missing answer/);
    assert.equal(primary.steps.length, 0);
    assert.equal(primary.usage.jev_calls, 0);
    assert.equal(await page.locator("select").inputValue(), "a");
  } finally { await browser.close(); }
});

test("disclosures and custom toggles expose state and execute one native action", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const fixture of [
      { html: '<details><summary>More</summary><a href="/export">Export CSV</a></details>', label: 'More', before: 'collapsed', after: 'expanded', check: async () => assert.equal(await page.locator('details').evaluate(el => el.open), true) },
      { html: '<style>.sr{position:absolute;width:1px;height:1px;margin:-1px;clip-path:inset(50%)}label{display:inline-block;padding:12px}</style><input type="radio" id="tab" class="sr"><label for="tab">By Technician</label>', label: 'By Technician', before: 'unchecked', after: 'checked', check: async () => assert.equal(await page.locator('#tab').isChecked(), true) },
      { html: '<input type="checkbox" id="updates" style="display:none"><label for="updates">Updates</label>', label: 'Updates', before: 'unchecked', after: 'checked', check: async () => assert.equal(await page.locator('#updates').isChecked(), true) },
      { html: '<label style="display:inline-block;padding:12px"><input type="checkbox" style="display:none">Wrapped checkbox</label>', label: 'Wrapped checkbox', before: 'unchecked', after: 'checked', check: async () => assert.equal(await page.locator('input').isChecked(), true) },
      { html: '<input type="checkbox" aria-label="Round checkbox" style="width:24px;height:24px;clip-path:circle(45%)">', label: 'Round checkbox', before: 'unchecked', after: 'checked', check: async () => assert.equal(await page.locator('input').isChecked(), true) },
      { html: '<label><input type="checkbox" checked>Visible checkbox</label>', label: 'Visible checkbox', before: 'checked', after: 'unchecked', check: async () => assert.equal(await page.locator('input').isChecked(), false) },
      { html: '<table><tr><th aria-sort="ascending"><button onclick="this.parentElement.setAttribute(\'aria-sort\',\'descending\')">Name</button></th></tr></table>', label: 'Name', before: 'sorted ascending', after: 'sorted descending', check: async () => assert.equal(await page.locator('th').getAttribute('aria-sort'), 'descending') },
    ]) {
      await page.setContent(fixture.html);
      const states = [];
      const result = await navigate({ task: `Change ${fixture.label}`, page, allowTyping: false, maxSteps: 2, screenshot: 'none', transport: {
        name: 'fixture', async ask(request) {
          states.push(request.state);
          const chosen = request.state.interactive_elements.find(el => el.description.includes(`"${fixture.label}"`));
          assert.ok(chosen);
          assert.ok(chosen.description.includes(states.length === 1 ? fixture.before : fixture.after));
          const choice = states.length === 1 ? `click_${chosen.id}` : 'done';
          return { answers: { action: { type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(request.questions.action.criteria).map(key => [key, key === choice ? 1 : 0])) }, goal_done: { type: 'noul', noul: 0 }, stuck: { type: 'noul', noul: 0 } }, usage, model: 'fixture' };
        },
      }});
      assert.equal(result.steps[0].action_error, undefined);
      assert.notEqual(result.steps[0].outcome, 'no visible change');
      assert.equal(states.length, 2);
      await fixture.check();
      if (fixture.label === 'More') {
        assert.equal(states[0].interactive_elements.length, 1);
        assert.ok(states[1].interactive_elements.some(el => el.description.includes('Export CSV')));
      }
    }
  } finally { await browser.close(); }
});

test("control observations use bounded state tokens, never field values or arbitrary ARIA strings", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<button aria-pressed="true" aria-expanded="false">Toggle</button><button role="tab" aria-selected="true">Tab</button><button role="checkbox" aria-checked="mixed">Mixed</button><button aria-pressed="private-aria-token">Unknown</button><label>Account<input value="private-field-token"></label><input type="password" value="private-password-token"><table><tr><th aria-sort="private-sort-token"><button>Bad sort</button></th></tr></table>');
    let observed;
    await navigate({ task: 'Inspect controls', page, maxSteps: 1, screenshot: 'none', allowTyping: false, transport: {
      name: 'fixture', async ask(request) {
        observed = request.state.interactive_elements;
        return { answers: { action: { type: 'choice', choice: 'done', probabilities: Object.fromEntries(Object.keys(request.questions.action.criteria).map(key => [key, key === 'done' ? 1 : 0])) }, goal_done: { type: 'noul', noul: 0 }, stuck: { type: 'noul', noul: 0 } }, usage, model: 'fixture' };
      },
    }});
    assert.ok(observed.some(el => el.description.includes('pressed, collapsed')));
    assert.ok(observed.some(el => el.description.includes('(selected)')));
    assert.ok(observed.some(el => el.description.includes('(mixed)')));
    assert.equal(JSON.stringify(observed).includes('private-'), false);
  } finally { await browser.close(); }
});

test("repeat-no-op recovery never falls back to a write; it follows a link or stops stuck", async (t) => {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (String(error).includes("Executable doesn't exist")) {
      t.skip("Playwright browser binary is not installed");
      return;
    }
    throw error;
  }
  try {
    for (const withLink of [false, true]) {
      const page = await browser.newPage();
      // Short page: scroll_down has no effect, so a repeated scroll_down triggers recovery.
      const body = `<h1>Moka Express</h1><button type="button" onclick="window.writes = (window.writes || 0) + 1">Add to cart</button>${withLink ? '<a href="https://fixture.test/next">Next page</a>' : ""}`;
      await page.route("https://fixture.test/**", (route) => route.fulfill({ contentType: "text/html", body: route.request().url().endsWith("/next") ? "<h1>Next page</h1>" : body }));
      await page.goto("https://fixture.test/");
      // The model always prefers scrolling; the write button is the best fallback, then the link.
      const transport = { name: "scripted", async ask({ questions }) {
        const keys = Object.keys(questions.action.criteria);
        const weight = (key) => /Add to cart/.test(questions.action.criteria[key]) ? 0.3 : /Next page/.test(questions.action.criteria[key]) ? 0.1 : 0;
        const probabilities = Object.fromEntries(keys.map((key) => [key, weight(key)]));
        probabilities.scroll_down = 1 - Object.values(probabilities).reduce((a, b) => a + b, 0);
        return { answers: { action: { type: "choice", choice: "scroll_down", probabilities }, goal_done: { type: "noul", noul: 0 }, stuck: { type: "noul", noul: 0 } }, usage, model: "scripted" };
      } };
      const result = await navigate({ task: "Add the Moka Express in Midnight Blue to the cart", page, transport, allowTyping: false, maxSteps: 3, screenshot: "none" });
      assert.equal(await page.evaluate(() => window.writes ?? 0), 0, "recovery must never click the write button");
      assert.equal(result.steps[0].executed_action, "scroll_down");
      if (withLink) {
        assert.match(result.steps[1].recovery_reason, /read-only/);
        assert.match(result.steps[1].detail, /Next page/);
        assert.match(result.final_url, /\/next$/);
      } else {
        assert.equal(result.status, "stuck");
        assert.equal(result.steps.length, 2);
        assert.equal(result.steps[1].executed_action, null);
        assert.match(result.steps[1].recovery_reason, /no read-only alternate/);
      }
      await page.close();
    }
  } finally { await browser.close(); }
});

test("repeat-no-op recovery after a repeated typing step stops stuck instead of typing elsewhere or submitting", async (t) => {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (String(error).includes("Executable doesn't exist")) {
      t.skip("Playwright browser binary is not installed");
      return;
    }
    throw error;
  }
  // Local OpenAI-compatible stand-in for the typing provider: always types the same name.
  const { createServer } = await import("node:http");
  const typingApi = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "chatcmpl-fake", object: "chat.completion", created: 0, model: "fake-typing-model", choices: [{ index: 0, message: { role: "assistant", content: "Ada Lovelace" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise((resolve) => typingApi.listen(0, "127.0.0.1", resolve));
  const previous = process.env.JEV_BROWSER_TYPE_BASE_URL;
  process.env.JEV_BROWSER_TYPE_BASE_URL = `http://127.0.0.1:${typingApi.address().port}/v1`;
  try {
    const page = await browser.newPage();
    await page.setContent('<form onsubmit="event.preventDefault(); window.submits = (window.submits || 0) + 1"><label for="name">Full name</label><input id="name"><label for="email">Email</label><input id="email" type="email"><button type="submit">Send message</button></form>');
    // Jev keeps re-picking the name field; typing into the email field and submitting are the next-best options.
    const transport = { name: "scripted", async ask({ questions }) {
      const criteria = questions.action.criteria;
      const weight = (key) => key.startsWith("type_") && /Full name/.test(criteria[key]) ? 0.5 : key.startsWith("type_") && /Email/.test(criteria[key]) ? 0.3 : /Send message/.test(criteria[key]) ? 0.2 : 0;
      const probabilities = Object.fromEntries(Object.keys(criteria).map((key) => [key, weight(key)]));
      const choice = Object.keys(probabilities).find((key) => probabilities[key] === 0.5);
      return { answers: { action: { type: "choice", choice, probabilities }, goal_done: { type: "noul", noul: 0 }, stuck: { type: "noul", noul: 0 } }, usage, model: "scripted" };
    } };
    const result = await navigate({ task: "Fill in the name Ada Lovelace and the email ada@example.com without sending the form", page, transport, maxSteps: 4, screenshot: "none" });
    assert.match(result.steps[0].detail, /^typed "Ada Lovelace"/);
    assert.equal(result.status, "stuck");
    assert.equal(result.steps.length, 2);
    assert.equal(result.steps[1].executed_action, null);
    assert.match(result.steps[1].recovery_reason, /no read-only alternate/);
    assert.equal(await page.locator("#name").inputValue(), "Ada Lovelace");
    assert.equal(await page.locator("#email").inputValue(), "", "recovery must not type into another field");
    assert.equal(await page.evaluate(() => window.submits ?? 0), 0, "recovery must not submit the form");
  } finally {
    if (previous === undefined) delete process.env.JEV_BROWSER_TYPE_BASE_URL; else process.env.JEV_BROWSER_TYPE_BASE_URL = previous;
    await browser.close();
    await new Promise((resolve) => typingApi.close(resolve));
  }
});

test("wait action reaches content that renders after 3 s, and the stuck watcher defers while a request is in flight", async (t) => {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (String(error).includes("Executable doesn't exist")) {
      t.skip("Playwright browser binary is not installed");
      return;
    }
    throw error;
  }
  try {
    for (const viaRequest of [false, true]) {
      const page = await browser.newPage();
      // Timer variant: the link appears 3 s after load with nothing in flight.
      // Request variant: the link arrives in a response that takes 6 s, while stuck stays at 0.95.
      const load = viaRequest
        ? "fetch('https://fixture.test/api/reports').then((r) => r.text()).then((html) => { document.getElementById('list').innerHTML = html; });"
        : "setTimeout(() => { document.getElementById('list').innerHTML = '<a href=\"https://fixture.test/q3\">Q3 2026 sales summary</a>'; }, 3000);";
      await page.route("https://fixture.test/**", async (route) => {
        const url = route.request().url();
        if (url.endsWith("/api/reports")) {
          await new Promise((resolve) => setTimeout(resolve, 6000));
          return route.fulfill({ contentType: "text/html", body: '<a href="https://fixture.test/q3">Q3 2026 sales summary</a>' });
        }
        return route.fulfill({ contentType: "text/html", body: url.endsWith("/q3") ? "<h1>Q3 2026 sales summary</h1>" : `<h1>Reports</h1><div id="list">Loading reports…</div><script>${load}</script>` });
      });
      const transport = { name: "scripted", async ask({ questions }) {
        const criteria = questions.action.criteria;
        const link = Object.keys(criteria).find((key) => /Q3 2026/.test(criteria[key]));
        const done = /^Q3 2026/.test(String(await page.title().catch(() => ""))) || page.url().endsWith("/q3");
        const choice = done ? "done" : link ?? "wait";
        const probabilities = Object.fromEntries(Object.keys(criteria).map((key) => [key, key === choice ? 1 : 0]));
        return { answers: { action: { type: "choice", choice, probabilities }, goal_done: { type: "noul", noul: 0 }, stuck: { type: "noul", noul: viaRequest && !link ? 0.95 : 0 } }, usage, model: "scripted" };
      } };
      const result = await navigate({ task: "Open the Q3 2026 sales summary report", startUrl: "https://fixture.test/", page, transport, allowTyping: false, maxSteps: 8, maxSeconds: 60, screenshot: "none" });
      assert.equal(result.status, "done", JSON.stringify(result.steps.map((s) => [s.executed_action, s.detail])));
      assert.match(result.final_url, /\/q3$/);
      assert.ok(result.steps.some((s) => s.executed_action === "wait" && s.detail.startsWith("waited 2 s")));
      if (viaRequest) assert.ok(result.steps.some((s) => /stuck watcher deferred/.test(s.detail)), "stuck must defer while the request is in flight");
      await page.close();
    }
  } finally { await browser.close(); }
});

test("a page that always looks busy defers the stuck stop at most twice", async (t) => {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (String(error).includes("Executable doesn't exist")) {
      t.skip("Playwright browser binary is not installed");
      return;
    }
    throw error;
  }
  try {
    const page = await browser.newPage();
    // A long-poll request that never answers keeps one request in flight for the whole run.
    await page.route("https://busy.test/**", (route) => {
      if (route.request().url().endsWith("/stream")) return;
      return route.fulfill({ contentType: "text/html", body: "<h1>Live feed</h1><a href='https://busy.test/x'>Reports</a><script>fetch('/stream')</script>" });
    });
    const transport = { name: "scripted", async ask({ questions }) {
      const keys = Object.keys(questions.action.criteria);
      return { answers: { action: { type: "choice", choice: "wait", probabilities: Object.fromEntries(keys.map((key) => [key, key === "wait" ? 1 : 0])) }, goal_done: { type: "noul", noul: 0 }, stuck: { type: "noul", noul: 0.95 } }, usage, model: "scripted" };
    } };
    const result = await navigate({ task: "Open the live feed report", startUrl: "https://busy.test/", page, transport, allowTyping: false, maxSteps: 12, maxSeconds: 60, screenshot: "none" });
    assert.equal(result.status, "stuck");
    assert.equal(result.steps.filter((s) => /stuck watcher deferred/.test(s.detail)).length, 2);
    assert.equal(result.steps.length, 5, "steps 3 and 4 defer; step 5 stops");
  } finally { await browser.close(); }
});
