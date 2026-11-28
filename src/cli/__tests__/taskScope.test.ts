import { describe, it, expect } from 'vitest';
import { criticalPath, parseTasks, resolveTasks } from '../commands/task';

const A = `#+TODO: TODO NEXT | DONE CANCELLED
* Project                                     :@lead:
  :PROPERTIES:
  :ASSIGNEE: ana
  :END:
** DONE Design
   :PROPERTIES:
   :ID: design
   :EFFORT: 2d
   :END:
** TODO Build
   :PROPERTIES:
   :ID: build
   :EFFORT: 90m
   :ASSIGNEE: bo cy
   :DEPENDS: id:design id:remote
   :END:
** Steps
   :PROPERTIES:
   :ORDERED: t
   :END:
*** TODO First
    :PROPERTIES:
    :ID: first
    :EFFORT: 0:30
    :END:
*** TODO Second
    :PROPERTIES:
    :ID: second
    :EFFORT: 1d
    :END:
** TODO No id, not a task
`;

const B = `* TODO Remote work
  :PROPERTIES:
  :ID: remote
  :EFFORT: 4h
  :END:
* TODO Waits on nothing that exists
  :PROPERTIES:
  :ID: orphan
  :DEPENDS: id:missing
  :END:
* TODO Duplicate
  :PROPERTIES:
  :ID: first
  :END:
`;

describe('task CLI loading', () => {
    it('reads assignees, efforts and ORDERED like the project view', () => {
        const tasks = parseTasks(A, '/p/a.org');
        expect(tasks.map(t => t.id)).toEqual(['design', 'build', 'first', 'second']);
        const build = tasks.find(t => t.id === 'build')!;
        expect(build.assignees).toEqual(expect.arrayContaining(['bo', 'cy']));
        expect(build.ownAssignee).toBe('bo cy');
        expect(build.effortDays).toBeCloseTo(90 / 480);
        const first = tasks.find(t => t.id === 'first')!;
        expect(first.assignees).toEqual(expect.arrayContaining(['ana', 'lead']));
        expect(first.effortDays).toBeCloseTo(30 / 480);
        expect(tasks.find(t => t.id === 'second')!.blockedBy).toEqual(['first']);
        expect(tasks.find(t => t.id === 'design')!.done).toBe(true);
    });

    it('resolves dependencies across files, keeps unknown ids blocking, and reports duplicates', () => {
        const all = [...parseTasks(A, '/p/a.org'), ...parseTasks(B, '/p/b.org')];
        const { byId, duplicates } = resolveTasks(all);
        expect(byId.get('build')!.blockedBy).toEqual(['remote']);   // design is done
        expect(byId.get('orphan')!.blockedBy).toEqual(['missing']);
        expect(duplicates.get('first')).toEqual(['/p/a.org:22', '/p/b.org:11']);
        expect(byId.get('first')!.filePath).toBe('/p/a.org');

        byId.get('remote')!.done = true;
        const again = resolveTasks([...parseTasks(A, '/p/a.org'), ...parseTasks(B.replace('TODO Remote', 'DONE Remote'), '/p/b.org')]);
        expect(again.byId.get('build')!.blockedBy).toEqual([]);
    });

    it('computes the critical path over fractional efforts', () => {
        const { byId } = resolveTasks(parseTasks(A, '/p/a.org'));
        const cp = criticalPath([...byId.values()]);
        expect(cp.path.map(t => t.id)).toEqual(['first', 'second']);
        expect(cp.days).toBeCloseTo(1 + 30 / 480);
    });
});
