import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {listLocalSkills} from "../dist/lib/custom-resources.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-custom-"));
try {
  const skill = path.join(root, "my-personal-skill");
  await fs.mkdir(skill);
  await fs.writeFile(path.join(skill, "SKILL.md"), "---\ndescription: Local test skill\n---\n# Local fixture\n");
  await fs.mkdir(path.join(root, "no-skill-file"));
  await fs.symlink(skill, path.join(root, "linked-skill"));
  assert.deepEqual(await listLocalSkills(root), {
    skills: [{id:"my-personal-skill", name:"Local fixture", description:"Local test skill", source:skill}],
  });
  assert.deepEqual(await listLocalSkills(path.join(root, "missing")), {skills:[]});
  const symlinkOnly = path.join(root, "linked-base");
  await fs.symlink(root, symlinkOnly);
  assert.deepEqual(await listLocalSkills(symlinkOnly), {skills:[]});
  console.log("Custom local-skill discovery: passed (read-only, bounded, no symlink entries)");
} finally {
  await fs.rm(root, {recursive:true,force:true});
}