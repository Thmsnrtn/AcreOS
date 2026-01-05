import { Sidebar } from "@/components/layout-sidebar";
import { EmailSettingsContent } from "@/components/email-settings-content";

export default function EmailSettings() {
  return (
    <div className="flex min-h-screen w-full">
      <Sidebar />
      <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold" data-testid="heading-email-settings">
              Email Settings
            </h1>
            <p className="text-muted-foreground">
              Configure email sender identities and reply routing for your organization.
            </p>
          </div>
          <EmailSettingsContent />
        </div>
      </main>
    </div>
  );
}
