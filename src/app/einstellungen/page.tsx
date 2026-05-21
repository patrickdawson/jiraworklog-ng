import { EinstellungenForm } from "@/components/einstellungen-form";
import { getSettings } from "@/db/queries";
import { parseProjectKeys } from "@/lib/settings";
import { parseBreaks } from "@/lib/work-time";

export const dynamic = "force-dynamic";

export default function EinstellungenPage() {
  const s = getSettings();
  return (
    <EinstellungenForm
      initial={{
        regularWorkMinutes: s.regularWorkMinutes,
        dailyTargetMinutes: s.dailyTargetMinutes,
        breaks: parseBreaks(s.breaks),
        autoPauseEnabled: s.autoPauseEnabled,
        bookingMode: s.bookingMode,
        dataRetentionDays: s.dataRetentionDays,
        jiraUrl: s.jiraUrl,
        jiraProjectKeys: parseProjectKeys(s.jiraProjectKeys),
        jiraAuthMode: s.jiraAuthMode,
        jiraToken: s.jiraToken,
        jiraUser: s.jiraUser,
        jiraPassword: s.jiraPassword,
        allgemeinesIssueKey: s.allgemeinesIssueKey,
        addAllgemeinesSummary: s.addAllgemeinesSummary,
      }}
    />
  );
}
