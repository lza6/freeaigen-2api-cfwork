// =================================================================================
//  项目: freeaigen-2api (Cloudflare Worker 单文件版)
//  版本: 1.0.0 (代号: Chimera - Prompt Alchemist)
//  作者: 首席AI执行官 (Principal AI Executive Officer)
//  协议: 奇美拉协议 · 综合版 (Project Chimera: Synthesis Edition)
//  日期: 2025-11-26
//
//  描述:
//  本文件是一个完全自包含、可一键部署的 Cloudflare Worker。它将 freeaigen.com
//  的提示词优化服务，无损地转换为一个高性能、兼容 OpenAI 标准的 API。
//  内置"开发者驾驶舱"Web UI，支持实时测试和一键集成。
// =================================================================================

// --- [第一部分: 核心配置 (Configuration-as-Code)] ---
const CONFIG = {
  // 项目元数据
  PROJECT_NAME: "freeaigen-2api",
  PROJECT_VERSION: "1.0.0",
  
  // 安全配置 (建议在 Cloudflare 环境变量中设置 API_MASTER_KEY)
  API_MASTER_KEY: "1", 
  
  // 上游服务配置
  UPSTREAM_URL: "https://freeaigen.com/api/enhance-prompt",
  ORIGIN_URL: "https://freeaigen.com",
  REFERER_URL: "https://freeaigen.com/zh?ref=foundr.ai&utm_source=foundr.ai",
  
  // 模型列表 (虚拟模型，实际上都指向同一个优化服务)
  MODELS: [
    "freeaigen-prompt-enhancer",
    "gpt-4o-prompt-engineer"
  ],
  DEFAULT_MODEL: "freeaigen-prompt-enhancer",

  // 伪装指纹 (来自您的抓包数据)
  HEADERS: {
    "accept": "*/*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "content-type": "application/json",
    "priority": "u=1, i",
    "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
  },
  
  // 凭证 (来自您的抓包数据，虽然您说无需登录，但带上这些能通过 CF 验证)
  COOKIE: "NEXT_LOCALE=zh; _ga_6ZK6LSKJ0G=GS2.1.s1764122458$o1$g0$t1764122458$j60$l0$h0; _ga=GA1.1.250160850.1764122458; __Host-authjs.csrf-token=e7a132a34d3ecf8c67b8b9d285d9c3adb54defc7440e7d1d57560bdcdbe8bc98%7Cf4d0699cc9ff643133209e90d2524313ef463abbdeab8ae5ac66247c49d4711d; __Secure-authjs.callback-url=https%3A%2F%2Ffreeaigen.com; g_state={\"i_l\":0,\"i_ll\":1764122464730,\"i_b\":\"RG0B8aK8M1fKCRf4BSXHe+UxdZNo3yoVKE+5f+SCRTE\"}; __stripe_mid=7013f4c7-87ad-4df7-bda8-b0ff23e537bf6c9e90; __stripe_sid=d751fa90-b6ab-40c1-90a9-a8d77737e44a5fd8e6"
};

// --- [第二部分: Worker 入口与路由] ---
export default {
  async fetch(request, env, ctx) {
    // 优先读取环境变量中的密钥
    const apiKey = env.API_MASTER_KEY || CONFIG.API_MASTER_KEY;
    const url = new URL(request.url);

    // 1. 预检请求
    if (request.method === 'OPTIONS') {
      return handleCorsPreflight();
    }

    // 2. 开发者驾驶舱 (Web UI)
    if (url.pathname === '/') {
      return handleUI(request, apiKey);
    } 
    // 3. API 路由
    else if (url.pathname.startsWith('/v1/')) {
      return handleApi(request, apiKey);
    } 
    // 4. 404
    else {
      return createErrorResponse(`路径未找到: ${url.pathname}`, 404, 'not_found');
    }
  }
};

// --- [第三部分: API 代理逻辑] ---

/**
 * API 路由分发
 */
async function handleApi(request, apiKey) {
  // 鉴权
  const authHeader = request.headers.get('Authorization');
  if (apiKey && apiKey !== "1") {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return createErrorResponse('需要 Bearer Token 认证。', 401, 'unauthorized');
    }
    const token = authHeader.substring(7);
    if (token !== apiKey) {
      return createErrorResponse('无效的 API Key。', 403, 'invalid_api_key');
    }
  }

  const url = new URL(request.url);
  const requestId = `req-${crypto.randomUUID()}`;

  if (url.pathname === '/v1/models') {
    return handleModelsRequest();
  } else if (url.pathname === '/v1/chat/completions') {
    return handleChatCompletions(request, requestId);
  } else {
    return createErrorResponse(`不支持的 API 路径: ${url.pathname}`, 404, 'not_found');
  }
}

/**
 * 处理 /v1/models
 */
function handleModelsRequest() {
  const modelsData = {
    object: 'list',
    data: CONFIG.MODELS.map(modelId => ({
      id: modelId,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'freeaigen-2api',
    })),
  };
  return new Response(JSON.stringify(modelsData), {
    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' })
  });
}

/**
 * 核心：执行上游请求
 */
async function performUpstreamRequest(prompt) {
  const payload = {
    prompt: prompt
  };

  const headers = {
    ...CONFIG.HEADERS,
    "origin": CONFIG.ORIGIN_URL,
    "referer": CONFIG.REFERER_URL,
    "cookie": CONFIG.COOKIE
  };

  const response = await fetch(CONFIG.UPSTREAM_URL, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`上游服务错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  
  if (!data.success) {
    throw new Error(`上游处理失败: ${JSON.stringify(data)}`);
  }

  return data.enhancedPrompt;
}

/**
 * 处理 /v1/chat/completions
 */
async function handleChatCompletions(request, requestId) {
  try {
    const body = await request.json();
    const messages = body.messages || [];
    const lastMsg = messages.reverse().find(m => m.role === 'user');
    if (!lastMsg) throw new Error("未找到用户消息");

    const prompt = lastMsg.content;
    
    // 执行上游请求
    const enhancedPrompt = await performUpstreamRequest(prompt);
    
    // 模拟流式响应 (Pseudo-Streaming)
    if (body.stream) {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      (async () => {
        // 模拟打字机效果，将完整文本拆分为小块发送
        const chunkSize = 5; // 每次发送5个字符
        for (let i = 0; i < enhancedPrompt.length; i += chunkSize) {
            const chunkContent = enhancedPrompt.slice(i, i + chunkSize);
            const chunk = {
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: body.model || CONFIG.DEFAULT_MODEL,
                choices: [{ index: 0, delta: { content: chunkContent }, finish_reason: null }]
            };
            await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            await new Promise(r => setTimeout(r, 20)); // 20ms 延迟，模拟生成感
        }
        
        const endChunk = {
          id: requestId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: body.model || CONFIG.DEFAULT_MODEL,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(endChunk)}\n\n`));
        await writer.write(encoder.encode('data: [DONE]\n\n'));
        await writer.close();
      })();

      return new Response(readable, {
        headers: corsHeaders({ 'Content-Type': 'text/event-stream' })
      });
    } else {
      // 非流式
      return new Response(JSON.stringify({
        id: requestId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model || CONFIG.DEFAULT_MODEL,
        choices: [{
          index: 0,
          message: { role: "assistant", content: enhancedPrompt },
          finish_reason: "stop"
        }]
      }), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });
    }

  } catch (e) {
    return createErrorResponse(e.message, 500, 'generation_failed');
  }
}

// --- 辅助函数 ---
function createErrorResponse(message, status, code) {
  return new Response(JSON.stringify({
    error: { message, type: 'api_error', code }
  }), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' })
  });
}

function handleCorsPreflight() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

function corsHeaders(headers = {}) {
  return {
    ...headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// --- [第四部分: 开发者驾驶舱 UI] ---
function handleUI(request, apiKey) {
  const origin = new URL(request.url).origin;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${CONFIG.PROJECT_NAME} - 开发者驾驶舱</title>
    <style>
      :root { --bg: #121212; --panel: #1E1E1E; --border: #333; --text: #E0E0E0; --primary: #FFBF00; --accent: #007AFF; }
      body { font-family: 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); margin: 0; height: 100vh; display: flex; overflow: hidden; }
      .sidebar { width: 380px; background: var(--panel); border-right: 1px solid var(--border); padding: 20px; display: flex; flex-direction: column; overflow-y: auto; }
      .main { flex: 1; display: flex; flex-direction: column; padding: 20px; }
      
      .box { background: #252525; padding: 12px; border-radius: 6px; border: 1px solid var(--border); margin-bottom: 15px; }
      .label { font-size: 12px; color: #888; margin-bottom: 5px; display: block; }
      .code-block { font-family: monospace; font-size: 12px; color: var(--primary); word-break: break-all; background: #111; padding: 8px; border-radius: 4px; cursor: pointer; }
      
      input, select, textarea { width: 100%; background: #333; border: 1px solid #444; color: #fff; padding: 8px; border-radius: 4px; margin-bottom: 10px; box-sizing: border-box; }
      button { width: 100%; padding: 10px; background: var(--primary); border: none; border-radius: 4px; font-weight: bold; cursor: pointer; color: #000; }
      button:disabled { background: #555; cursor: not-allowed; }
      
      .chat-window { flex: 1; background: #000; border: 1px solid var(--border); border-radius: 8px; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 15px; }
      .msg { max-width: 80%; padding: 10px 15px; border-radius: 8px; line-height: 1.5; }
      .msg.user { align-self: flex-end; background: #333; color: #fff; }
      .msg.ai { align-self: flex-start; background: #1a1a1a; border: 1px solid #333; width: 100%; max-width: 100%; white-space: pre-wrap; }
      
      .status-bar { margin-top: 10px; font-size: 12px; color: #888; display: flex; justify-content: space-between; }
      .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid #888; border-top-color: var(--primary); border-radius: 50%; animation: spin 1s linear infinite; margin-right: 5px; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="sidebar">
        <h2 style="margin-top:0">✨ ${CONFIG.PROJECT_NAME} <span style="font-size:12px;color:#888">v${CONFIG.PROJECT_VERSION}</span></h2>
        
        <div class="box">
            <span class="label">API 密钥 (点击复制)</span>
            <div class="code-block" onclick="copy('${apiKey}')">${apiKey}</div>
        </div>

        <div class="box">
            <span class="label">API 接口地址</span>
            <div class="code-block" onclick="copy('${origin}/v1/chat/completions')">${origin}/v1/chat/completions</div>
        </div>

        <div class="box">
            <span class="label">模型</span>
            <select id="model">
                ${CONFIG.MODELS.map(m => `<option value="${m}">${m}</option>`).join('')}
            </select>
            
            <span class="label" style="margin-top:10px">原始提示词 (Prompt)</span>
            <textarea id="prompt" rows="4" placeholder="输入简单的提示词，例如：a cat"></textarea>
            
            <button id="btn-gen" onclick="generate()">优化提示词</button>
        </div>
        
        <div class="box">
            <span class="label">功能说明</span>
            <div style="font-size:12px; color:#aaa; line-height:1.4;">
                此服务将 FreeAIGen 的提示词优化功能封装为 OpenAI 格式。
                <br><br>
                输入简短描述，AI 将返回适用于 Midjourney/Stable Diffusion 的详细英文提示词。
            </div>
        </div>
    </div>

    <main class="main">
        <div class="chat-window" id="chat">
            <div style="color:#666; text-align:center; margin-top:50px;">
                提示词优化代理服务就绪。<br>
                支持 API 调用或直接在此测试。
            </div>
        </div>
    </main>

    <script>
        const API_KEY = "${apiKey}";
        const ENDPOINT = "${origin}/v1/chat/completions";
        
        function copy(text) {
            navigator.clipboard.writeText(text);
            alert('已复制');
        }

        function appendMsg(role, text) {
            const div = document.createElement('div');
            div.className = \`msg \${role}\`;
            div.innerHTML = text; // Allow HTML for spinner
            document.getElementById('chat').appendChild(div);
            div.scrollIntoView({ behavior: "smooth" });
            return div;
        }

        async function generate() {
            const prompt = document.getElementById('prompt').value.trim();
            if (!prompt) return alert('请输入提示词');

            const btn = document.getElementById('btn-gen');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> 优化中...';

            // 清空欢迎语
            if(document.querySelector('.chat-window').innerText.includes('代理服务就绪')) {
                document.getElementById('chat').innerHTML = '';
            }

            appendMsg('user', prompt);
            const aiMsg = appendMsg('ai', '<span class="spinner"></span> 正在请求 FreeAIGen 优化...');

            try {
                const res = await fetch(ENDPOINT, {
                    method: 'POST',
                    headers: { 
                        'Authorization': 'Bearer ' + API_KEY, 
                        'Content-Type': 'application/json' 
                    },
                    body: JSON.stringify({
                        model: document.getElementById('model').value,
                        messages: [{ role: "user", content: prompt }],
                        stream: true
                    })
                });

                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error?.message || '请求失败');
                }

                // 处理流式响应
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let fullText = "";
                aiMsg.innerHTML = ""; // 清空 loading

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\\n');
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.slice(6);
                            if (dataStr === '[DONE]') break;
                            try {
                                const data = JSON.parse(dataStr);
                                const content = data.choices[0].delta.content;
                                if (content) {
                                    fullText += content;
                                    aiMsg.innerText = fullText;
                                    // 自动滚动
                                    document.getElementById('chat').scrollTop = document.getElementById('chat').scrollHeight;
                                }
                            } catch (e) {}
                        }
                    }
                }

            } catch (e) {
                aiMsg.innerHTML = \`<span style="color:#CF6679">❌ 错误: \${e.message}</span>\`;
            } finally {
                btn.disabled = false;
                btn.innerText = "优化提示词";
            }
        }
    </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Encoding': 'br'
    },
  });
}
