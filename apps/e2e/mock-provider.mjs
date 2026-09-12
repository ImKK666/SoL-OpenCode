/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Deterministic OpenAI-compatible mock provider for the e2e harness.
 *
 * - GET /v1/models and POST /v1/chat/completions (streaming + JSON)
 * - records every request body (in memory and as JSONL) for token accounting
 * - decides each assistant turn from a scripted conversation, keyed on how many
 *   tool results the request already carries, so runs are deterministic
 *
 * Run standalone:  MOCK_PORT=4599 MOCK_LOG=/tmp/req.jsonl MOCK_SCRIPT='{...}' node mock-provider.mjs
 * Or embed:        const mock = await startMockProvider({ port, log, script })
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function nextTurn(messages, script) {
	const toolResults = messages.filter((message) => message.role === "tool").length;
	const lastUser = [...messages].reverse().find((message) => message.role === "user");
	const prompt = typeof lastUser?.content === "string" ? lastUser.content : "";
	let steps = script["*"];
	for (const [needle, value] of Object.entries(script)) {
		if (needle !== "*" && prompt.includes(needle)) {
			steps = value;
			break;
		}
	}
	steps = steps ?? ["done."];
	let step = steps[Math.min(toolResults, steps.length - 1)];
	if (step && typeof step === "object" && !Array.isArray(step) && step.conditional) {
		const lastTool = [...messages].reverse().find((message) => message.role === "tool");
		const content = typeof lastTool?.content === "string" ? lastTool.content : JSON.stringify(lastTool?.content ?? "");
		step = content.includes("[then_run:") ? step.ifFused : step.ifNotFused;
	}
	return typeof step === "string" ? { text: step } : { toolCalls: step };
}

function isReducerRequest(messages) {
	const system = messages.find((message) => message.role === "system");
	return typeof system?.content === "string" && system.content.includes("lossless test/build output reducer");
}

/**
 * Answer the Evidence-Preserving Reducer's child-session call with a receipt
 * built from the request itself: the source hash and a literal quote are both
 * present in the reducer input, so the receipt passes verification.
 */
function reducerReceipt(messages) {
	const text = messages
		.map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")))
		.join("\n");
	const hash = /source_sha256=([0-9a-f]{64})/.exec(text)?.[1] ?? "";
	const isError = /is_error=true/.test(text);
	const log = /<untrusted_log>([\s\S]*?)<\/untrusted_log>/.exec(text)?.[1] ?? "";
	const lines = log.split("\n");
	const line = lines.find((entry) => /error|failed|failure/i.test(entry)) ?? lines[0] ?? "";
	return JSON.stringify({
		schema: "sol-opencode-evidence-receipt/1",
		source_sha256: hash,
		status: isError ? "failure" : "success",
		uncertain: false,
		evidence: line ? [{ kind: isError ? "failure" : "summary", quote: line.slice(0, 200) }] : [],
	});
}

function textPayload(body, model, text) {
	return {
		id: `chatcmpl-${Date.now()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: body.model ?? model,
		choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
	};
}

function toolPayload(body, model, messages, calls) {
	const offset = messages.filter((message) => message.role === "tool").length;
	return {
		id: `chatcmpl-${Date.now()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: body.model ?? model,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: null,
					tool_calls: calls.map((call, index) => ({
						id: `call_${offset + index}`,
						type: "function",
						function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
					})),
				},
				finish_reason: "tool_calls",
			},
		],
	};
}

function writeStream(response, payload) {
	const choice = payload.choices[0];
	const base = { id: payload.id, object: "chat.completion.chunk", created: payload.created, model: payload.model };
	const chunk = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
	response.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	response.write(`data: ${JSON.stringify(chunk({ role: "assistant" }))}\n\n`);
	if (choice.message.tool_calls) {
		choice.message.tool_calls.forEach((call, index) => {
			response.write(
				`data: ${JSON.stringify(
					chunk({
						tool_calls: [
							{ index, id: call.id, type: "function", function: { name: call.function.name, arguments: "" } },
						],
					}),
				)}\n\n`,
			);
			response.write(
				`data: ${JSON.stringify(
					chunk({ tool_calls: [{ index, function: { arguments: call.function.arguments } }] }),
				)}\n\n`,
			);
		});
		response.write(`data: ${JSON.stringify(chunk({}, "tool_calls"))}\n\n`);
	} else {
		response.write(`data: ${JSON.stringify(chunk({ content: choice.message.content }))}\n\n`);
		response.write(`data: ${JSON.stringify(chunk({}, "stop"))}\n\n`);
	}
	response.write("data: [DONE]\n\n");
	response.end();
}

function readBody(request) {	return new Promise((resolve, reject) => {
		let data = "";
		request.on("data", (chunk) => {
			data += chunk;
		});
		request.on("end", () => resolve(data));
		request.on("error", reject);
	});
}

export async function startMockProvider({ port = 4599, log, model = "mock-1", script = {} }) {
	if (log) mkdirSync(dirname(log), { recursive: true });
	const requests = [];
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
		if (request.method === "GET" && url.pathname === "/v1/models") {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ object: "list", data: [{ id: model, object: "model", owned_by: "mock" }] }));
			return;
		}
		if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
			const raw = await readBody(request);
			let body;
			try {
				body = JSON.parse(raw);
			} catch {
				body = {};
			}
			requests.push({ ts: Date.now(), body });
			if (log) appendFileSync(log, `${JSON.stringify({ ts: Date.now(), body })}\n`);
			const messages = Array.isArray(body.messages) ? body.messages : [];
			let payload;
			if (isReducerRequest(messages)) {
				payload = textPayload(body, model, reducerReceipt(messages));
			} else {
				const turn = nextTurn(messages, script);
				payload =
					turn.text !== undefined
						? textPayload(body, model, turn.text)
						: toolPayload(body, model, messages, turn.toolCalls);
			}
			if (body.stream === true) writeStream(response, payload);
			else {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(JSON.stringify(payload));
			}
			return;
		}
		response.writeHead(404, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: "not found" }));
	});
	await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
	return {
		url: `http://127.0.0.1:${port}/v1`,
		requests,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
	const script = JSON.parse(process.env.MOCK_SCRIPT ?? "{}");
	const mock = await startMockProvider({
		port: Number(process.env.MOCK_PORT ?? 4599),
		log: process.env.MOCK_LOG ?? "/tmp/sol-e2e/requests.jsonl",
		model: process.env.MOCK_MODEL ?? "mock-1",
		script,
	});
	console.log(`mock provider listening on ${mock.url}`);
}
