import { describe } from "node:test";
import { assertSymlinkTarget } from "../../helpers/skill-dir.ts";
import {
  registerSharedSkillDirDeployScenarios,
  registerSharedSkillDirRevertScenarios,
} from "../../helpers/skill-dir-scenarios.ts";

describe("skill-dir deploy and revert (POSIX)", {
  skip: process.platform === "win32",
}, () => {
  registerSharedSkillDirDeployScenarios({
    method: "symlink",
    async assertManagedTarget(target, source) {
      await assertSymlinkTarget(target, source);
    },
  });

  registerSharedSkillDirRevertScenarios({
    method: "symlink",
    async assertManagedTarget(target, source) {
      await assertSymlinkTarget(target, source);
    },
  });
});
