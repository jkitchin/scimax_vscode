/**
 * A CustomAgendaSource over ScimaxDbCore, shared by the CLI and the tests.
 * The extension supplies its own agendaView (with blocked-task and assignee
 * handling) and reuses the rest.
 */

import * as fs from 'fs';
import format from 'date-fns/format';
import addDays from 'date-fns/addDays';
import startOfDay from 'date-fns/startOfDay';
import type { HeadingRecord, ScimaxDbCore } from '../database/scimaxDbCore';
import { DEFAULT_DONE_STATES } from '../database/scimaxDbCore';
import { filterAgendaItems, type AgendaViewConfig, type AgendaView } from './orgAgenda';
import { dbItemToAgendaItem, groupItemsByDate } from './orgAgendaDb';
import { DEFAULT_STUCK_PROJECTS, type CustomAgendaSource, type StuckProjectsConfig } from './orgAgendaCustom';

type Db = Pick<ScimaxDbCore, 'getAgenda' | 'getHeadingsMatching' | 'getHeadingsInFile' | 'getHeadingsInFilesContaining'>;

export interface DbSourceOptions {
    doneStates?: string[];
    requireTodoState?: boolean;
    isExcluded?: (file: string) => boolean;
    stuckProjects?: Partial<StuckProjectsConfig>;
    /** Replace the dated agenda query (the extension passes its own) */
    agendaView?: (config: Partial<AgendaViewConfig>) => Promise<AgendaView>;
    now?: () => Date;
}

/** Done if the file's #+TODO line says so, or the keyword is a configured done state. */
export function makeIsDone(doneStates: string[]): (h: Pick<HeadingRecord, 'todo_state' | 'todo_type'>) => boolean {
    const set = new Set(doneStates);
    return h => h.todo_type === 'done' || (!!h.todo_state && set.has(h.todo_state));
}

export function createDbAgendaSource(db: Db, options: DbSourceOptions = {}): CustomAgendaSource {
    const doneStates = options.doneStates ?? DEFAULT_DONE_STATES;
    const isExcluded = options.isExcluded ?? (() => false);
    const now = options.now ?? (() => new Date());

    const agendaView = options.agendaView ?? (async (config: Partial<AgendaViewConfig>): Promise<AgendaView> => {
        const startDate = startOfDay(config.startDate ?? now());
        const days = config.days ?? 7;
        const endDate = addDays(startDate, days);
        const dbItems = await db.getAgenda({
            before: format(endDate, 'yyyy-MM-dd'),
            includeUnscheduled: false,
            requireTodoState: options.requireTodoState ?? true,
            doneStates,
        });
        const fullConfig: AgendaViewConfig = {
            type: 'week', startDate, days, showDone: false, showHabits: true,
            sortBy: 'time', groupBy: 'date', ...config,
        };
        const items = dbItems.filter(i => !isExcluded(i.heading.file_path)).map(dbItemToAgendaItem);
        const groups = groupItemsByDate(filterAgendaItems(items, fullConfig), startDate, days, now());
        return {
            config: fullConfig,
            groups,
            totalItems: groups.reduce((n, g) => n + g.items.length, 0),
            totalFiles: 0,
            dateRange: { start: startDate, end: endDate },
        };
    });

    return {
        agendaView,
        headings: prefilter => db.getHeadingsMatching({ ...prefilter, doneStates }),
        headingsInFile: file => db.getHeadingsInFile(file),
        searchHeadings: (words, scope) => db.getHeadingsInFilesContaining(words, scope),
        readFile: async file => {
            try {
                return await fs.promises.readFile(file, 'utf8');
            } catch {
                return undefined;
            }
        },
        isExcluded,
        isDone: makeIsDone(doneStates),
        stuckProjects: { ...DEFAULT_STUCK_PROJECTS, ...options.stuckProjects },
    };
}
