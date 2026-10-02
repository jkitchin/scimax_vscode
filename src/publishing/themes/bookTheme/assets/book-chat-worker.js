/**
 * Book Theme: the "Ask the docs" model runs in this worker so the page stays
 * responsive while it loads and answers. Keep the WebLLM version the same as
 * WEBLLM_URL in book-chat.js.
 */
import { WebWorkerMLCEngineHandler } from 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message) => handler.onmessage(message);
