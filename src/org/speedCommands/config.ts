/**
 * Speed Command Configuration
 *
 * Defines all available speed commands and their mappings.
 */

export interface SpeedCommandDefinition {
    /** The key that triggers this command */
    key: string;
    /** Command ID to execute */
    command: string;
    /** Description for help display */
    description: string;
    /** Category for grouping in help */
    category: 'navigation' | 'visibility' | 'structure' | 'todo' | 'planning' | 'metadata' | 'clocking' | 'special';
    /** Whether this command is a built-in VS Code command */
    isBuiltin?: boolean;
}

/**
 * All speed command definitions
 */
export const SPEED_COMMAND_DEFINITIONS: SpeedCommandDefinition[] = [
    // Navigation
    { key: 'n', command: 'scimax.org.nextHeading', description: 'Next visible heading', category: 'navigation' },
    { key: 'p', command: 'scimax.org.previousHeading', description: 'Previous visible heading', category: 'navigation' },
    { key: 'f', command: 'scimax.speed.nextSibling', description: 'Next heading same level', category: 'navigation' },
    { key: 'b', command: 'scimax.speed.previousSibling', description: 'Previous heading same level', category: 'navigation' },
    { key: 'u', command: 'scimax.org.parentHeading', description: 'Parent heading', category: 'navigation' },
    { key: 'j', command: 'scimax.org.jumpToHeading', description: 'Jump to heading', category: 'navigation' },
    { key: 'g', command: 'scimax.speed.gotoMenu', description: 'Go to... (submenu)', category: 'navigation' },

    // Visibility/Folding
    { key: 'c', command: 'scimax.org.cycleGlobalFold', description: 'Cycle global visibility', category: 'visibility' },
    { key: 'C', command: 'scimax.speed.showChildren', description: 'Show all children', category: 'visibility' },
    { key: 'o', command: 'scimax.speed.overview', description: 'Overview (fold all)', category: 'visibility' },
    { key: 'Tab', command: 'scimax.org.toggleFold', description: 'Cycle fold at point', category: 'visibility' },

    // Structure Editing
    { key: 'U', command: 'scimax.heading.moveUp', description: 'Move subtree up', category: 'structure' },
    { key: 'D', command: 'scimax.heading.moveDown', description: 'Move subtree down', category: 'structure' },
    { key: 'r', command: 'scimax.heading.demote', description: 'Demote heading', category: 'structure' },
    { key: 'l', command: 'scimax.heading.promote', description: 'Promote heading', category: 'structure' },
    { key: 'R', command: 'scimax.heading.demoteSubtree', description: 'Demote subtree', category: 'structure' },
    { key: 'L', command: 'scimax.heading.promoteSubtree', description: 'Promote subtree', category: 'structure' },
    { key: 'w', command: 'scimax.org.killSubtree', description: 'Kill (cut) subtree', category: 'structure' },
    { key: 'y', command: 'scimax.speed.yankSubtree', description: 'Yank (paste) subtree', category: 'structure' },
    { key: 'W', command: 'scimax.org.cloneSubtree', description: 'Clone subtree', category: 'structure' },
    { key: '@', command: 'scimax.org.markSubtree', description: 'Mark (select) subtree', category: 'structure' },

    // TODO/State
    { key: 't', command: 'scimax.org.cycleTodo', description: 'Cycle TODO state', category: 'todo' },
    { key: ',', command: 'scimax.org.shiftTimestampUp', description: 'Cycle priority up', category: 'todo' },
    { key: '1', command: 'scimax.speed.priorityA', description: 'Set priority [#A]', category: 'todo' },
    { key: '2', command: 'scimax.speed.priorityB', description: 'Set priority [#B]', category: 'todo' },
    { key: '3', command: 'scimax.speed.priorityC', description: 'Set priority [#C]', category: 'todo' },
    { key: '0', command: 'scimax.speed.priorityNone', description: 'Remove priority', category: 'todo' },

    // Planning
    { key: 's', command: 'scimax.speed.schedule', description: 'Add/edit SCHEDULED', category: 'planning' },
    { key: 'd', command: 'scimax.speed.deadline', description: 'Add/edit DEADLINE', category: 'planning' },
    { key: '.', command: 'scimax.org.insertTimestamp', description: 'Insert timestamp', category: 'planning' },

    // Metadata
    { key: ':', command: 'scimax.speed.setTags', description: 'Set tags', category: 'metadata' },
    { key: 'e', command: 'scimax.speed.setEffort', description: 'Set effort', category: 'metadata' },
    { key: 'P', command: 'scimax.speed.setProperty', description: 'Set property', category: 'metadata' },

    // Clocking
    { key: 'I', command: 'scimax.speed.clockIn', description: 'Clock in', category: 'clocking' },
    { key: 'O', command: 'scimax.speed.clockOut', description: 'Clock out', category: 'clocking' },

    // Special
    { key: 'a', command: 'scimax.speed.archiveSubtree', description: 'Archive subtree', category: 'special' },
    { key: 'A', command: 'scimax.speed.toggleArchiveTag', description: 'Toggle :ARCHIVE: tag', category: 'special' },
    { key: '$', command: 'scimax.speed.archiveToSibling', description: 'Archive to sibling', category: 'special' },
    { key: 'N', command: 'scimax.speed.narrowToSubtree', description: 'Narrow to subtree', category: 'special' },
    { key: 'S', command: 'scimax.speed.widen', description: 'Widen (show all)', category: 'special' },
    { key: '?', command: 'scimax.speed.help', description: 'Speed commands help', category: 'special' },
];

/**
 * Get speed command by key
 */
export function getSpeedCommand(key: string): SpeedCommandDefinition | undefined {
    return SPEED_COMMAND_DEFINITIONS.find(cmd => cmd.key === key);
}

/**
 * Get all speed commands grouped by category
 */
export function getSpeedCommandsByCategory(): Map<string, SpeedCommandDefinition[]> {
    const categories = new Map<string, SpeedCommandDefinition[]>();

    for (const cmd of SPEED_COMMAND_DEFINITIONS) {
        const existing = categories.get(cmd.category) || [];
        existing.push(cmd);
        categories.set(cmd.category, existing);
    }

    return categories;
}
