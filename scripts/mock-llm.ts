// Minimal OpenAI-compatible mock (SSE streaming, tool-calling) for e2e tests.
import http from 'node:http';

const PORT = 18_777;

interface ChatMessage {
  role: string;
  content?: string | any[] | null;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

const server = http.createServer((req, res) => {
  if (!req.url?.includes('/chat/completions')) {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      return;
    }
    res.writeHead(404).end();
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const parsed = JSON.parse(body) as { messages: ChatMessage[]; stream?: boolean };
    const last = parsed.messages[parsed.messages.length - 1];

    // Decide: if the last message is a tool result, finish with text; else call the tool.
    const sawToolResult = parsed.messages.some((m) => m.role === 'tool');

    const send = (obj: any) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const id = 'chatcmpl-mock';
    const created = Math.floor(Date.now() / 1000);
    const base = { id, object: 'chat.completion.chunk', created, model: 'mock-model' };

    send({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });

    if (!sawToolResult) {
      // Step 1: ask for a tool call (echo via bash? no — use a safe file read)
      send({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'read_file', arguments: JSON.stringify({ path: 'package.json' }) },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      // Step 2: answer with text summarizing what the tool returned
      send({ ...base, choices: [{ index: 0, delta: { content: 'Selesai. ' }, finish_reason: null }] });
      send({ ...base, choices: [{ index: 0, delta: { content: 'File package.json terbaca oleh tool.' }, finish_reason: null }] });
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    res.write('data: [DONE]\n\n');
    res.end();
    void last;
  });
});

server.listen(PORT, () => {
  console.log(`mock-llm listening on http://127.0.0.1:${PORT}/v1`);
});

export { server, PORT };
