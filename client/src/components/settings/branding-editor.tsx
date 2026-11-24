import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useUserPermissions } from "@/hooks/use-organization";
import { useTenantTheme, type TenantTheme } from "@/contexts/tenant-theme-context";
import { Palette, Loader2, RotateCcw } from "lucide-react";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

interface BrandingForm {
  brandAccentColor: string;
  brandLogoUrl: string;
}

function toForm(theme: TenantTheme): BrandingForm {
  return {
    brandAccentColor: theme.brandAccentColor ?? "",
    brandLogoUrl: theme.brandLogoUrl ?? "",
  };
}

/**
 * Company branding editor — Settings → Organization.
 *
 * Wires the org-level brand affordances (accent color, logo) that
 * previously could only be set through the API (PATCH /api/tenant-theme)
 * to a real UI. Writes require owner/admin (enforced server-side too);
 * everyone else sees the current brand read-only.
 *
 * There is deliberately NO density picker here (EL-P1 A2-12): the old
 * one wrote organizations.brandDensity, which nothing applied —
 * `data-density` is the person's own Accessibility & comfort reading
 * density, and org branding must never override a person's reading or
 * accessibility settings. A stored-but-never-applied setting under
 * "Applied across the app for every member" copy was a false promise.
 */
export function BrandingEditor() {
  const { toast } = useToast();
  const { data: permissions } = useUserPermissions();
  const { brandAccentColor, brandLogoUrl, isLoaded } = useTenantTheme();

  const isAdmin = permissions?.role === "owner" || permissions?.role === "admin";

  const [form, setForm] = useState<BrandingForm>({ brandAccentColor: "", brandLogoUrl: "" });
  const [dirty, setDirty] = useState(false);
  const [hexError, setHexError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  // Seed the form from the loaded theme; reset when it changes underneath us.
  useEffect(() => {
    if (isLoaded) {
      setForm(toForm({ brandAccentColor, brandLogoUrl }));
      setDirty(false);
    }
  }, [isLoaded, brandAccentColor, brandLogoUrl]);

  const saveMutation = useMutation({
    mutationFn: async (body: { brandAccentColor: string | null; brandLogoUrl: string | null }) => {
      const res = await apiRequest("PATCH", "/api/tenant-theme", body);
      return res.json() as Promise<TenantTheme>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant-theme"] });
      setDirty(false);
      toast({ title: "Brand updated", description: "Your organization's branding is live." });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't save branding", description: err.message, variant: "destructive" });
    },
  });

  const update = (patch: Partial<BrandingForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
    if (patch.brandAccentColor !== undefined) {
      setHexError(
        patch.brandAccentColor === "" || HEX_RE.test(patch.brandAccentColor)
          ? null
          : "Use a 6-digit hex color like #2563eb, or clear it for the theme default.",
      );
    }
    if (patch.brandLogoUrl !== undefined) {
      if (patch.brandLogoUrl === "") {
        setUrlError(null);
      } else {
        try {
          const u = new URL(patch.brandLogoUrl);
          setUrlError(u.protocol === "http:" || u.protocol === "https:" ? null : "Logo must be an http(s) URL.");
        } catch {
          setUrlError("Logo must be an absolute URL, e.g. https://example.com/logo.png");
        }
      }
    }
  };

  const handleSave = () => {
    if (hexError || urlError) return;
    saveMutation.mutate({
      brandAccentColor: form.brandAccentColor === "" ? null : form.brandAccentColor,
      brandLogoUrl: form.brandLogoUrl === "" ? null : form.brandLogoUrl,
    });
  };

  const handleReset = () => {
    setForm({ brandAccentColor: "", brandLogoUrl: "" });
    setHexError(null);
    setUrlError(null);
    saveMutation.mutate({ brandAccentColor: null, brandLogoUrl: null });
  };

  if (!isLoaded) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5" aria-hidden="true" />
            Company branding
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" announceText="Loading branding settings" />
          <Skeleton className="h-10 w-full" announce={false} />
        </CardContent>
      </Card>
    );
  }

  const canSave = isAdmin && dirty && !hexError && !urlError && !saveMutation.isPending;

  return (
    <Card data-testid="card-branding-editor">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="w-5 h-5" aria-hidden="true" />
          Company branding
        </CardTitle>
        <CardDescription>
          Your organization's accent color and logo. Applied across the app for every member.
          {!isAdmin && " Only owners and admins can change these."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Accent color */}
        <div className="space-y-2">
          <Label htmlFor="branding-accent">Accent color</Label>
          <div className="flex items-center gap-3">
            <input
              id="branding-accent"
              type="color"
              value={form.brandAccentColor === "" ? "#000000" : form.brandAccentColor}
              onChange={(e) => update({ brandAccentColor: e.target.value })}
              disabled={!isAdmin}
              className="h-10 w-14 cursor-pointer rounded border bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="input-brand-accent-picker"
              aria-label="Accent color picker"
            />
            <Input
              value={form.brandAccentColor}
              onChange={(e) => update({ brandAccentColor: e.target.value })}
              placeholder="#2563eb (empty = theme default)"
              disabled={!isAdmin}
              className="max-w-64 font-mono"
              data-testid="input-brand-accent-hex"
              aria-label="Accent color hex value"
              aria-invalid={!!hexError}
              aria-describedby={hexError ? "branding-accent-error" : undefined}
            />
            {form.brandAccentColor !== "" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => update({ brandAccentColor: "" })}
                disabled={!isAdmin}
                data-testid="button-brand-accent-clear"
              >
                Clear
              </Button>
            )}
          </div>
          {hexError && (
            <p id="branding-accent-error" className="text-sm text-destructive" role="alert">
              {hexError}
            </p>
          )}
        </div>

        {/* Logo */}
        <div className="space-y-2">
          <Label htmlFor="branding-logo">Logo URL</Label>
          <div className="flex items-start gap-4">
            <div className="flex-1 space-y-2">
              <Input
                id="branding-logo"
                value={form.brandLogoUrl}
                onChange={(e) => update({ brandLogoUrl: e.target.value })}
                placeholder="https://example.com/logo.png (empty = AcreOS mark)"
                disabled={!isAdmin}
                data-testid="input-brand-logo-url"
                aria-invalid={!!urlError}
                aria-describedby={urlError ? "branding-logo-error" : undefined}
              />
              {urlError && (
                <p id="branding-logo-error" className="text-sm text-destructive" role="alert">
                  {urlError}
                </p>
              )}
            </div>
            {form.brandLogoUrl !== "" && !urlError && (
              <img
                src={form.brandLogoUrl}
                alt="Brand logo preview"
                className="h-10 max-w-32 rounded border object-contain"
                data-testid="img-brand-logo-preview"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={handleSave} disabled={!canSave} data-testid="button-branding-save">
              {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
              Save branding
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={saveMutation.isPending} data-testid="button-branding-reset">
              <RotateCcw className="w-4 h-4 mr-2" aria-hidden="true" />
              Reset to defaults
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
