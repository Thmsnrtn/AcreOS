import { Sidebar } from "@/components/layout-sidebar";
import { MailSettingsContent } from "@/components/mail-settings-content";

export default function MailSettings() {
  return (
    <div className="flex min-h-screen w-full">
      <Sidebar />
      <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold" data-testid="heading-mail-settings">
              Mail Settings
            </h1>
            <p className="text-muted-foreground">
              Configure return addresses for your direct mail campaigns.
            </p>
          </div>
          <MailSettingsContent />
        </div>
      </main>
    </div>
  );
}
