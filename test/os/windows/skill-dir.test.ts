import { describe } from "node:test";
import { assertCopyTarget } from "../../helpers/skill-dir.ts";
import {
  registerSharedSkillDirDeployScenarios,
  registerSharedSkillDirRevertScenarios,
} from "../../helpers/skill-dir-scenarios.ts";

describe("skill-dir deploy and revert (Windows)", {
  skip: process.platform !== "win32",
}, () => {
  registerSharedSkillDirDeployScenarios({
    method: "copy",
    async assertManagedTarget(target, _source, expectedSkillMd) {
      await assertCopyTarget(target, expectedSkillMd);
    },
  });

  registerSharedSkillDirRevertScenarios({
    method: "copy",
    async assertManagedTarget(target, _source, expectedSkillMd) {
      await assertCopyTarget(target, expectedSkillMd);
    },
  });
});
