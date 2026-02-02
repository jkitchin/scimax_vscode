/**
 * Link Graph Module
 *
 * Provides visualization and querying of file link relationships.
 * Files are connected by org-mode links, enabling graph-based exploration
 * of your knowledge base.
 *
 * Features:
 * - Interactive graph visualization with vis.js
 * - Draggable nodes for custom layouts
 * - Click to open files, double-click to recenter
 * - Filter by tags, TODO states, modification time, etc.
 * - Adjustable depth for exploring connections
 * - Bidirectional link tracking (forward and backlinks)
 */

export { LinkGraphQueryService, LinkGraphFilters, GraphNode, GraphEdge, GraphData } from './linkGraphQueries';
export { LinkGraphProvider } from './linkGraphProvider';
export { registerLinkGraphCommands } from './commands';
