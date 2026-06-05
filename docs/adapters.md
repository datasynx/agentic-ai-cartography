# Native adapters for non-MCP frameworks

Some agent frameworks don't read a config file — they load MCP tools through their
own adapter classes. Cartography needs **no special support** for these; point them
at the standard stdio command and they'll pick up every tool, just like an MCP host.

Standard launch command (used in every snippet below):

```
npx -y --package @datasynx/agentic-ai-cartography cartography-mcp
```

> Run a discovery first (`datasynx-cartography discover`) so the catalog has a
> topology to serve. Cartography's MCP **prompts** and **resources** are available
> in full MCP hosts; some adapters below load **tools only** (noted inline).

---

## LangGraph / LangChain (Python)

```bash
pip install langchain-mcp-adapters
```

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

client = MultiServerMCPClient({
    "cartography": {
        "command": "npx",
        "args": ["-y", "--package", "@datasynx/agentic-ai-cartography", "cartography-mcp"],
        "transport": "stdio",
    },
    # or a remote Streamable HTTP server:
    # "cartography": {"url": "http://127.0.0.1:3737/mcp", "transport": "streamable_http"},
})
tools = await client.get_tools()  # hand `tools` to create_react_agent / create_agent
```

`MultiServerMCPClient` is stateless by default (a new session per tool call); use
`client.session("cartography")` for a stateful session. JS: `@langchain/mcp-adapters`.

## Microsoft AutoGen (Python)

```bash
pip install "autogen-ext[mcp]"
```

```python
from autogen_ext.tools.mcp import McpWorkbench, StdioServerParams

params = StdioServerParams(
    command="npx",
    args=["-y", "--package", "@datasynx/agentic-ai-cartography", "cartography-mcp"],
    read_timeout_seconds=60,
)
async with McpWorkbench(params) as mcp:
    agent = AssistantAgent("assistant", model_client=..., workbench=mcp)
```

> AutoGen is in maintenance mode; for new projects Microsoft points to the
> **Microsoft Agent Framework (MAF)**, which speaks MCP + A2A.

## CrewAI (Python)

```bash
pip install "crewai-tools[mcp]"
```

```python
from crewai_tools import MCPServerAdapter
from mcp import StdioServerParameters

server_params = StdioServerParameters(
    command="npx",
    args=["-y", "--package", "@datasynx/agentic-ai-cartography", "cartography-mcp"],
)
with MCPServerAdapter(server_params) as tools:
    agent = Agent(role="SRE", goal="Map the system", backstory="...", tools=tools)
```

> `MCPServerAdapter` exposes **tools only** (no prompts/resources).

## Pydantic AI (Python)

```bash
pip install "pydantic-ai-slim[mcp]"
```

```python
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStdio

server = MCPServerStdio("npx", args=["-y", "--package", "@datasynx/agentic-ai-cartography", "cartography-mcp"])
agent = Agent("openai:gpt-5.2", toolsets=[server])
```

`load_mcp_servers("config.json")` also reads an `mcpServers` JSON block directly.

## OpenAI Agents SDK (Python)

MCP support is built in:

```python
from agents import Agent
from agents.mcp import MCPServerStdio

async with MCPServerStdio(
    name="Cartography",
    params={"command": "npx", "args": ["-y", "--package", "@datasynx/agentic-ai-cartography", "cartography-mcp"]},
) as server:
    agent = Agent(name="Assistant", instructions="...", mcp_servers=[server])
```

Options: `cache_tools_list`, `tool_filter`, `max_retry_attempts`, `require_approval`.

## Smolagents (Python)

```bash
pip install "smolagents[mcp]"
```

```python
from smolagents import ToolCollection, CodeAgent
from mcp import StdioServerParameters

params = StdioServerParameters(
    command="npx",
    args=["-y", "--package", "@datasynx/agentic-ai-cartography", "cartography-mcp"],
)
with ToolCollection.from_mcp(params, trust_remote_code=True) as tc:
    agent = CodeAgent(tools=[*tc.tools], model=...)
```

## Vercel AI SDK (TypeScript)

```ts
import { experimental_createMCPClient as createMCPClient } from 'ai';
import { Experimental_StdioMCPTransport as StdioMCPTransport } from 'ai/mcp-stdio';

const mcp = await createMCPClient({
  transport: new StdioMCPTransport({
    command: 'npx',
    args: ['-y', '--package', '@datasynx/agentic-ai-cartography', 'cartography-mcp'],
  }),
});
const tools = await mcp.tools(); // MCP tools → AI SDK tools, any model
```

> Define your **own** tools with `inputSchema` (renamed from `parameters` in AI SDK
> **v5** — using `parameters` yields an empty schema / 400 errors). The MCP client
> is lightweight: **tools only**, no session management or resources.
