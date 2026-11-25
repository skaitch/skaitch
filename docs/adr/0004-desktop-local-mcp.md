# The desktop app's MCP is limited to the local machine

The desktop app exposes its MCP server over HTTP on `127.0.0.1` only, protected by a random token and by refusing requests that carry a browser `Origin` header; the assistant thus acts directly on the open project. The web's relay through the Firestore mailbox does not exist on the desktop. The stdio transport was rejected because it requires a second process and an IPC to maintain on three systems; without the token and the `Origin` check, any open web page could drive the project.
