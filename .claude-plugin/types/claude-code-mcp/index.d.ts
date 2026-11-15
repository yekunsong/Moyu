// The inputs of the MCP tools the session had connected when this mod
// was last saved, from each server's tools/list inputSchema.
// Merges into the engine's ToolCallInput (types/ McpToolInputs) so
// `e.tool === "mcp__<server>__<tool>"` narrows to the tool's arguments.
// Written again at a save of the mod with a server connected.
export {}
declare module 'claude-code' {
  interface McpToolInputs {
    /** Attach a note to a paragraph of the open novel. The note renders in the same style as the prose, prefixed "· AI", after the anchor paragraph. */
    mcp__moyu__annotate: {
      /** Paragraph ref from a snapshot, e.g. "p120". */
      ref: string
      /** The note, up to 600 characters. It shows after the paragraph. */
      text: string
    }
    /** Show, hide or toggle the novel pane. Hiding also restores the normal Claude Code theme; the page stays where it was. */
    mcp__moyu__boss: {
      /** true shows the pane, false hides it; absent toggles. */
      visible?: boolean
    }
    /** Find text in the whole open novel (case-insensitive) and return up to 20 excerpts with their surrounding context. */
    mcp__moyu__find: {
      /** Case-insensitive text to find in the open novel. */
      text: string
    }
    /** Open the novel pane at a library path (a text file, or a directory to list it). Starts the pane on first use. Prefer this before novel_read. */
    mcp__moyu__open: {
      /** A novel file or a directory under the library root. */
      path: string
    }
    /** Return the current page of the open novel with ref-tagged paragraphs. scope page reads what the person sees; next/prev turn a page first; chapter moves to the next chapter. Refs are valid until the next snapshot or turn. */
    mcp__moyu__read: {
      /** page (default) is what the person sees; next/prev turn one page; chapter moves to the next chapter. */
      scope?: "page" | "next" | "prev" | "chapter"
    }
    /** Turn pages in the open novel: positive delta forward, negative back. Returns the new position. */
    mcp__moyu__turn: {
      /** Pages to turn: positive forward, negative back. */
      delta: number
    }
  }
}
