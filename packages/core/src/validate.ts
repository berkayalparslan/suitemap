import * as v from 'valibot';
import { SuitemapDocumentSchema, type SuitemapDocument } from './schema.js';

export type ValidationResult =
  { ok: true; document: SuitemapDocument } | { ok: false; issues: string[] };

/** Validates shape and referential integrity (every id reference resolves, ids are unique). */
export function validateDocument(input: unknown): ValidationResult {
  const parsed = v.safeParse(SuitemapDocumentSchema, input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.issues.map((i) => {
        const path = i.path?.map((p) => String(p.key)).join('.') ?? '';
        return path ? `${path}: ${i.message}` : i.message;
      }),
    };
  }
  const doc = parsed.output;
  const issues: string[] = [];

  const ids = (name: string, list: { id: string }[]) => {
    const set = new Set<string>();
    for (const x of list) {
      if (set.has(x.id)) issues.push(`${name}: duplicate id "${x.id}"`);
      set.add(x.id);
    }
    return set;
  };
  const projectIds = ids('projects', doc.projects);
  const folderIds = ids('folders', doc.folders);
  const fileIds = ids('files', doc.files);
  const describeIds = ids('describes', doc.describes);
  const testIds = ids('tests', doc.tests);
  ids('instances', doc.instances);
  ids('conditionals', doc.conditionals);

  const need = (set: Set<string>, id: string | undefined, where: string) => {
    if (id !== undefined && !set.has(id)) issues.push(`${where}: unknown reference "${id}"`);
  };
  for (const p of doc.projects) {
    p.dependencies.forEach((d) => need(projectIds, d, `project ${p.id}.dependencies`));
    need(projectIds, p.teardown, `project ${p.id}.teardown`);
  }
  for (const f of doc.folders) need(folderIds, f.parentId, `folder ${f.id}.parentId`);
  for (const f of doc.files) need(folderIds, f.folderId, `file ${f.id}.folderId`);
  for (const d of doc.describes) {
    need(fileIds, d.fileId, `describe ${d.id}.fileId`);
    need(describeIds, d.parentId, `describe ${d.id}.parentId`);
  }
  for (const t of doc.tests) {
    need(fileIds, t.fileId, `test ${t.id}.fileId`);
    need(describeIds, t.describeId, `test ${t.id}.describeId`);
  }
  for (const i of doc.instances) {
    need(testIds, i.testId, `instance ${i.id}.testId`);
    need(projectIds, i.projectId, `instance ${i.id}.projectId`);
  }
  const instanceIds = new Set(doc.instances.map((i) => i.id));
  for (const c of doc.conditionals) {
    need(testIds, c.scope.testId, `conditional ${c.id}.scope.testId`);
    need(describeIds, c.scope.describeId, `conditional ${c.id}.scope.describeId`);
    need(fileIds, c.scope.fileId, `conditional ${c.id}.scope.fileId`);
    if (Array.isArray(c.appliesToProjects))
      c.appliesToProjects.forEach((p) =>
        need(projectIds, p, `conditional ${c.id}.appliesToProjects`),
      );
    c.observed?.forEach((o) => need(instanceIds, o.instanceId, `conditional ${c.id}.observed`));
  }

  return issues.length ? { ok: false, issues } : { ok: true, document: doc };
}
