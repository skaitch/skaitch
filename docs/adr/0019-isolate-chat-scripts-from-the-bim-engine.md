# Run chat scripts in an isolated JavaScript runtime

Code Mode lets the assistant or user combine read-only queries across the open project's storeys. The assistant runs generated scripts automatically and the chat keeps their source available to read and copy. Users run their own scripts explicitly from the chat composer.

Both editions run scripts in QuickJS WebAssembly inside a dedicated worker. The interpreter exposes an asynchronous `callTool` function to guest code. The host checks an explicit allowlist and sends each permitted query through the existing BIM service with the snapshot captured when the script started. Desktop runs those queries through its local service and Online uses its existing server service. Each script has limits on execution time, memory, tool calls and output.

A declarative list of calls would be simpler to validate but would require another mechanism for loops, dependent queries and aggregation. Running native JavaScript directly in a browser worker would give scripts access to browser APIs. The interpreter keeps those APIs out of scripts and the worker lets the chat stop execution without blocking the editor.
