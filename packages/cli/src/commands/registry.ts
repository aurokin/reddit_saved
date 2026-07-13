/**
 * Command registry — key is the full command path ("fetch context"), value is
 * the handler. Kept separate from the entry point so tests (e.g. the SKILL.md
 * drift guard) can import it without executing main().
 */

import { authLogin } from "../auth/login";
import { authLogout } from "../auth/logout";
import { authStatus } from "../auth/status";
import { backupInitCmd, backupStatusCmd, backupSyncCmd } from "./backup";
import { exportCmd } from "./export";
import { fetchCmd } from "./fetch";
import { fetchContextCmd } from "./fetch-context";
import { fetchInboxCmd } from "./fetch-inbox";
import { inboxCmd } from "./inbox";
import { jobsInstallLaunchdCmd, jobsRunCmd, jobsStatusCmd, jobsUninstallLaunchdCmd } from "./jobs";
import { linksRebuildCmd, linksSearchCmd, linksTopCmd } from "./links";
import { listCmd } from "./list";
import { researchCmd } from "./research";
import { searchCmd } from "./search";
import { statusCmd } from "./status";
import { tagAdd, tagCreate, tagDelete, tagList, tagRemove, tagRename, tagShow } from "./tag";
import { unsaveCmd } from "./unsave";

export type CommandHandler = (
  flags: Record<string, string | boolean>,
  positionals: string[],
) => Promise<void>;

export const COMMANDS: Record<string, CommandHandler> = {
  "auth login": authLogin,
  "auth status": authStatus,
  "auth logout": authLogout,
  fetch: fetchCmd,
  "fetch context": fetchContextCmd,
  "fetch inbox": fetchInboxCmd,
  inbox: inboxCmd,
  search: searchCmd,
  list: listCmd,
  research: researchCmd,
  status: statusCmd,
  export: exportCmd,
  unsave: unsaveCmd,
  "tag list": tagList,
  "tag create": tagCreate,
  "tag rename": tagRename,
  "tag delete": tagDelete,
  "tag add": tagAdd,
  "tag remove": tagRemove,
  "tag show": tagShow,
  "links top": linksTopCmd,
  "links search": linksSearchCmd,
  "links rebuild": linksRebuildCmd,
  "backup init": backupInitCmd,
  "backup sync": backupSyncCmd,
  "backup status": backupStatusCmd,
  "jobs run": jobsRunCmd,
  "jobs status": jobsStatusCmd,
  "jobs install-launchd": jobsInstallLaunchdCmd,
  "jobs uninstall-launchd": jobsUninstallLaunchdCmd,
};
