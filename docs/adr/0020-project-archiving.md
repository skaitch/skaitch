# Archive projects as a library state, not a project file property

Users want to hide finished projects from the home page without deleting them. An archived project stays intact, can still be opened and edited, and is unarchived from an Archived view on the home page. Archiving is reversible, so it asks for no confirmation; a toast offers to undo it.

The desktop app archives a project by moving its file into an `Archives/` subfolder of the project library, and unarchives it by moving it back. A name collision gets an automatic suffix (`House (2).skaitch`). The state is visible in the file explorer, survives copying the library, and never rewrites the file. Saving an archived project writes it in place, inside `Archives/`.

The web app stores an `archivedAt` date (or `null`) in the project's metadata document. Archived projects still count toward the account's project limit: the home page counter and the limit notice count every project, whatever view is shown, and the server keeps counting all project documents.

The archived state is not written to the project file. An exported then imported project always arrives active, in either edition. A flag inside the file would have kept the state across editions but would require rewriting the file on desktop and would carry one user's filing choice into another copy. A local index on desktop would have avoided moving files but would be lost when the library moves to another machine.

The MCP `list_projects` tool omits archived projects unless called with `includeArchived`; `select_project` still opens an archived project by id. There is no MCP tool to archive or unarchive: it remains a user action.
