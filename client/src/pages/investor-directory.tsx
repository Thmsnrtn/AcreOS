import { useId, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Users,
  Shield,
  MapPin,
  DollarSign,
  Edit2,
  Loader2,
  BadgeCheck,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";

interface InvestorProfile {
  id: number;
  organizationId: number;
  displayName: string;
  bio?: string;
  investmentFocus?: string[];
  targetStates?: string[];
  minDealSize?: string;
  maxDealSize?: string;
  verificationStatus: "pending" | "verified" | "rejected";
  verifiedAt?: string;
  totalDeals?: number;
  rating?: string;
  badgeLevel?: string;
  createdAt: string;
}

const FOCUS_OPTIONS = [
  "Raw land", "Timber", "Agricultural", "Recreational", "Residential subdivision",
  "Commercial", "Industrial", "Conservation easements", "Mineral rights",
];

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const reassurance = "Your changes are still on this device — try again.";

export default function InvestorDirectoryPage() {
  useDocumentTitle("Investor network");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [selfAttestation, setSelfAttestation] = useState("");
  const [profileForm, setProfileForm] = useState({
    displayName: "",
    bio: "",
    minDealSize: "",
    maxDealSize: "",
    investmentFocus: [] as string[],
    targetStates: [] as string[],
  });

  const displayNameId = useId();
  const bioId = useId();
  const minId = useId();
  const maxId = useId();
  const focusLegendId = useId();
  const statesLegendId = useId();
  const attestId = useId();

  const { data: myData, isLoading: myLoading } = useQuery<{ profile: InvestorProfile | null }>({
    queryKey: ["/api/investor-profiles/my"],
    queryFn: () => fetch("/api/investor-profiles/my").then(r => r.json()),
  });

  const { data: directoryData, isLoading: dirLoading } = useQuery<{ profiles: InvestorProfile[]; count: number }>({
    queryKey: ["/api/investor-profiles/directory"],
    queryFn: () => fetch("/api/investor-profiles/directory").then(r => r.json()),
  });

  const saveMutation = useMutation({
    mutationFn: (body: typeof profileForm) =>
      apiRequest("POST", "/api/investor-profiles", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor-profiles/my"] });
      setEditOpen(false);
      toast({ title: "Profile saved" });
    },
    onError: (err: any) =>
      toast({ title: "Couldn't save profile", description: `${err.message}. ${reassurance}`, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/investor-profiles/verify", { selfAttestation }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor-profiles/my"] });
      setVerifyOpen(false);
      toast({ title: "Identity verified", description: "Your investor badge is now active." });
    },
    onError: (err: any) =>
      toast({ title: "Couldn't verify identity", description: `${err.message}. ${reassurance}`, variant: "destructive" }),
  });

  const myProfile = myData?.profile;
  const directory = directoryData?.profiles || [];

  function openEditWithCurrentData() {
    if (myProfile) {
      setProfileForm({
        displayName: myProfile.displayName || "",
        bio: myProfile.bio || "",
        minDealSize: myProfile.minDealSize || "",
        maxDealSize: myProfile.maxDealSize || "",
        investmentFocus: myProfile.investmentFocus || [],
        targetStates: myProfile.targetStates || [],
      });
    }
    setEditOpen(true);
  }

  function toggleFocus(f: string) {
    setProfileForm(p => ({
      ...p,
      investmentFocus: p.investmentFocus.includes(f)
        ? p.investmentFocus.filter(x => x !== f)
        : [...p.investmentFocus, f],
    }));
  }

  function toggleState(s: string) {
    setProfileForm(p => ({
      ...p,
      targetStates: p.targetStates.includes(s)
        ? p.targetStates.filter(x => x !== s)
        : [...p.targetStates, s],
    }));
  }

  function handleSaveSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profileForm.displayName || saveMutation.isPending) return;
    saveMutation.mutate(profileForm);
  }

  function handleVerifySubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (selfAttestation.length < 50 || verifyMutation.isPending) return;
    verifyMutation.mutate();
  }

  return (
    <PageShell label="Investor directory">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Investor network</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Your investor profile and verified land investor directory</p>
        </div>
        <div className="flex gap-2">
          {myProfile?.verificationStatus !== "verified" && (
            <Button variant="outline" onClick={() => setVerifyOpen(true)}>
              <BadgeCheck className="h-4 w-4 mr-2" aria-hidden="true" />
              Get verified
            </Button>
          )}
          <Button onClick={openEditWithCurrentData}>
            <Edit2 className="h-4 w-4 mr-2" aria-hidden="true" />
            {myProfile ? "Edit profile" : "Create profile"}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* My Profile */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">My investor profile</CardTitle>
            </CardHeader>
            <CardContent>
              {myLoading ? (
                <div className="flex justify-center py-6" role="status" aria-label="Loading your profile">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
                </div>
              ) : !myProfile ? (
                <div className="text-center py-6">
                  <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground mb-3">Create your investor profile to appear in the network directory.</p>
                  <Button onClick={() => setEditOpen(true)} size="sm">Create profile</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{myProfile.displayName}</h3>
                      {myProfile.bio && <p className="text-xs text-muted-foreground mt-0.5">{myProfile.bio}</p>}
                    </div>
                    {myProfile.verificationStatus === "verified" ? (
                      <Badge
                        className="bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos"
                        aria-label="Identity verified"
                      >
                        <BadgeCheck className="h-3 w-3 mr-1" aria-hidden="true" />
                        Verified
                      </Badge>
                    ) : (
                      <Badge variant="secondary" aria-label="Identity not yet verified">Unverified</Badge>
                    )}
                  </div>
                  <dl className="space-y-3">
                    {myProfile.investmentFocus && myProfile.investmentFocus.length > 0 && (
                      <div>
                        <dt className="text-xs text-muted-foreground mb-1">Investment focus</dt>
                        <dd>
                          <ul className="flex flex-wrap gap-1 list-none p-0 m-0" aria-label="Investment focus areas">
                            {myProfile.investmentFocus.map(f => (
                              <li key={f}>
                                <Badge variant="outline" className="text-xs">{f}</Badge>
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                    {myProfile.targetStates && myProfile.targetStates.length > 0 && (
                      <div>
                        <dt className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          <MapPin className="h-3 w-3" aria-hidden="true" /> Target states
                        </dt>
                        <dd className="text-sm">{myProfile.targetStates.join(", ")}</dd>
                      </div>
                    )}
                    {(myProfile.minDealSize || myProfile.maxDealSize) && (
                      <div>
                        <dt className="text-xs text-muted-foreground mb-1">Deal size range</dt>
                        <dd className="flex items-center gap-1 text-sm tabular-nums">
                          <DollarSign className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          {myProfile.minDealSize && usd(myProfile.minDealSize, { noCents: true })}
                          {myProfile.minDealSize && myProfile.maxDealSize && " – "}
                          {myProfile.maxDealSize && usd(myProfile.maxDealSize, { noCents: true })}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Directory */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Verified investors ({directory.length})</CardTitle>
                <Badge variant="secondary" className="flex items-center gap-1" aria-label="Directory shows verified investors only">
                  <Shield className="h-3 w-3" aria-hidden="true" />
                  Verified only
                </Badge>
              </div>
              <CardDescription className="text-xs">Land investors with verified identities in the AcreOS network</CardDescription>
            </CardHeader>
            <CardContent>
              {dirLoading ? (
                <div className="flex justify-center py-8" role="status" aria-label="Loading directory">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
                </div>
              ) : directory.length === 0 ? (
                <div className="text-center py-10">
                  <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                  <p className="text-muted-foreground">No verified investors yet. Be the first to get verified!</p>
                </div>
              ) : (
                <ul className="space-y-3 list-none p-0 m-0" aria-label="Verified investor directory">
                  {directory.map(profile => (
                    <li key={profile.id} className="flex items-start gap-3 p-3 border rounded-card">
                      <div className="p-2 bg-muted rounded-full flex-shrink-0">
                        <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{profile.displayName}</span>
                          <BadgeCheck className="h-4 w-4 text-acr-pos" aria-label="Verified investor" />
                          {profile.badgeLevel && <Badge variant="secondary" className="text-xs">{profile.badgeLevel}</Badge>}
                        </div>
                        {profile.bio && <p className="text-xs text-muted-foreground mt-0.5 truncate">{profile.bio}</p>}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(profile.investmentFocus || []).slice(0, 3).map(f => (
                            <Badge key={f} variant="outline" className="text-xs py-0">{f}</Badge>
                          ))}
                          {(profile.targetStates || []).slice(0, 3).map(s => (
                            <Badge key={s} variant="secondary" className="text-xs py-0">{s}</Badge>
                          ))}
                        </div>
                      </div>
                      {profile.totalDeals && (
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold tabular-nums" aria-label={`${profile.totalDeals} completed deals`}>{profile.totalDeals}</p>
                          <p className="text-xs text-muted-foreground">deals</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit Profile Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{myProfile ? "Edit" : "Create"} investor profile</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveSubmit}>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor={displayNameId}>Display name</Label>
                <Input
                  id={displayNameId}
                  placeholder="How you'll appear in the directory"
                  value={profileForm.displayName}
                  onChange={e => setProfileForm(p => ({ ...p, displayName: e.target.value }))}
                  autoCapitalize="words"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={bioId}>Bio</Label>
                <Textarea
                  id={bioId}
                  placeholder="Brief description of your investment strategy…"
                  value={profileForm.bio}
                  onChange={e => setProfileForm(p => ({ ...p, bio: e.target.value }))}
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={minId}>Min deal size ($)</Label>
                  <Input
                    id={minId}
                    type="number"
                    inputMode="numeric"
                    placeholder="5000"
                    value={profileForm.minDealSize}
                    onChange={e => setProfileForm(p => ({ ...p, minDealSize: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={maxId}>Max deal size ($)</Label>
                  <Input
                    id={maxId}
                    type="number"
                    inputMode="numeric"
                    placeholder="500000"
                    value={profileForm.maxDealSize}
                    onChange={e => setProfileForm(p => ({ ...p, maxDealSize: e.target.value }))}
                  />
                </div>
              </div>
              <fieldset className="space-y-1.5">
                <legend id={focusLegendId} className="text-sm font-medium leading-none">Investment focus</legend>
                <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={focusLegendId}>
                  {FOCUS_OPTIONS.map(f => {
                    const selected = profileForm.investmentFocus.includes(f);
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => toggleFocus(f)}
                        aria-pressed={selected}
                        aria-label={`${selected ? "Remove" : "Add"} focus area: ${f}`}
                        className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${selected ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                      >
                        {f}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend id={statesLegendId} className="text-sm font-medium leading-none">Target states</legend>
                <div className="flex flex-wrap gap-1" role="group" aria-labelledby={statesLegendId}>
                  {US_STATES.map(s => {
                    const selected = profileForm.targetStates.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleState(s)}
                        aria-pressed={selected}
                        aria-label={`${selected ? "Remove" : "Add"} target state: ${s}`}
                        className={`px-2 py-0.5 rounded text-xs border transition-colors ${selected ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!profileForm.displayName || saveMutation.isPending}>
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> : null}
                Save profile
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Verification Dialog */}
      <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Verify your identity</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleVerifySubmit}>
            <div className="space-y-4 py-2">
              <div
                role="region"
                aria-label="Verification benefits"
                className="p-3 bg-acr-accent dark:bg-acr-accent/20 rounded-card text-sm text-acr-accent dark:text-acr-accent"
              >
                <p className="font-medium mb-1">Verification enables:</p>
                <ul className="space-y-0.5 text-xs list-disc pl-4">
                  <li>Verified badge on your profile</li>
                  <li>Access to premium deal rooms</li>
                  <li>Higher visibility in buyer/seller matching</li>
                </ul>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={attestId}>Self-attestation statement</Label>
                <Textarea
                  id={attestId}
                  placeholder="I confirm that I am a legitimate land investor operating legally in my jurisdiction. I agree to AcreOS Marketplace Terms of Service and will conduct all transactions lawfully…"
                  value={selfAttestation}
                  onChange={e => setSelfAttestation(e.target.value)}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">By submitting, you attest to your identity and legal status as an investor.</p>
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setVerifyOpen(false)}>Cancel</Button>
              <Button
                type="submit"
                disabled={selfAttestation.length < 50 || verifyMutation.isPending}
              >
                {verifyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> : <BadgeCheck className="h-4 w-4 mr-2" aria-hidden="true" />}
                Submit verification
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
