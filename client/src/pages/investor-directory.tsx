import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  Shield,
  CheckCircle2,
  Star,
  MapPin,
  DollarSign,
  Edit2,
  Loader2,
  BadgeCheck,
  AlertCircle,
  FileText,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  "Raw Land", "Timber", "Agricultural", "Recreational", "Residential Subdivision",
  "Commercial", "Industrial", "Conservation Easements", "Mineral Rights",
];

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

export default function InvestorDirectoryPage() {
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
    onError: (err: any) => toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/investor-profiles/verify", { selfAttestation }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor-profiles/my"] });
      setVerifyOpen(false);
      toast({ title: "Identity verified", description: "Your investor badge is now active." });
    },
    onError: (err: any) => toast({ title: "Verification failed", description: err.message, variant: "destructive" }),
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

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Investor Network</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Your investor profile and verified buyer/seller directory</p>
        </div>
        <div className="flex gap-2">
          {myProfile?.verificationStatus !== "verified" && (
            <Button variant="outline" onClick={() => setVerifyOpen(true)}>
              <BadgeCheck className="h-4 w-4 mr-2" />
              Get Verified
            </Button>
          )}
          <Button onClick={openEditWithCurrentData}>
            <Edit2 className="h-4 w-4 mr-2" />
            {myProfile ? "Edit Profile" : "Create Profile"}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* My Profile */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">My Investor Profile</CardTitle>
            </CardHeader>
            <CardContent>
              {myLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !myProfile ? (
                <div className="text-center py-6">
                  <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground mb-3">Create your investor profile to appear in the network directory.</p>
                  <Button onClick={() => setEditOpen(true)} size="sm">Create Profile</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{myProfile.displayName}</h3>
                      {myProfile.bio && <p className="text-xs text-muted-foreground mt-0.5">{myProfile.bio}</p>}
                    </div>
                    {myProfile.verificationStatus === "verified" ? (
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                        <BadgeCheck className="h-3 w-3 mr-1" />
                        Verified
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Unverified</Badge>
                    )}
                  </div>
                  {myProfile.investmentFocus && myProfile.investmentFocus.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Investment Focus</p>
                      <div className="flex flex-wrap gap-1">
                        {myProfile.investmentFocus.map(f => (
                          <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {myProfile.targetStates && myProfile.targetStates.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> Target States
                      </p>
                      <p className="text-sm">{myProfile.targetStates.join(", ")}</p>
                    </div>
                  )}
                  {(myProfile.minDealSize || myProfile.maxDealSize) && (
                    <div className="flex items-center gap-1 text-sm">
                      <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                      {myProfile.minDealSize && `$${parseInt(myProfile.minDealSize).toLocaleString()}`}
                      {myProfile.minDealSize && myProfile.maxDealSize && " – "}
                      {myProfile.maxDealSize && `$${parseInt(myProfile.maxDealSize).toLocaleString()}`}
                    </div>
                  )}
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
                <CardTitle className="text-base">Verified Investors ({directory.length})</CardTitle>
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  Verified Only
                </Badge>
              </div>
              <CardDescription className="text-xs">Land investors with verified identities in the AcreOS network</CardDescription>
            </CardHeader>
            <CardContent>
              {dirLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : directory.length === 0 ? (
                <div className="text-center py-10">
                  <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No verified investors yet. Be the first to get verified!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {directory.map(profile => (
                    <div key={profile.id} className="flex items-start gap-3 p-3 border rounded-lg">
                      <div className="p-2 bg-muted rounded-full flex-shrink-0">
                        <Users className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{profile.displayName}</span>
                          <BadgeCheck className="h-4 w-4 text-emerald-500" />
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
                          <p className="text-sm font-semibold">{profile.totalDeals}</p>
                          <p className="text-xs text-muted-foreground">deals</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit Profile Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{myProfile ? "Edit" : "Create"} Investor Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Display Name</Label>
              <Input
                placeholder="How you'll appear in the directory"
                value={profileForm.displayName}
                onChange={e => setProfileForm(p => ({ ...p, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bio</Label>
              <Textarea
                placeholder="Brief description of your investment strategy..."
                value={profileForm.bio}
                onChange={e => setProfileForm(p => ({ ...p, bio: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Min Deal Size ($)</Label>
                <Input type="number" placeholder="5000" value={profileForm.minDealSize} onChange={e => setProfileForm(p => ({ ...p, minDealSize: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Max Deal Size ($)</Label>
                <Input type="number" placeholder="500000" value={profileForm.maxDealSize} onChange={e => setProfileForm(p => ({ ...p, maxDealSize: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Investment Focus</Label>
              <div className="flex flex-wrap gap-1.5">
                {FOCUS_OPTIONS.map(f => (
                  <button
                    key={f}
                    onClick={() => toggleFocus(f)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${profileForm.investmentFocus.includes(f) ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Target States</Label>
              <div className="flex flex-wrap gap-1">
                {US_STATES.map(s => (
                  <button
                    key={s}
                    onClick={() => toggleState(s)}
                    className={`px-2 py-0.5 rounded text-xs border transition-colors ${profileForm.targetStates.includes(s) ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate(profileForm)} disabled={!profileForm.displayName || saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Verification Dialog */}
      <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Verify Your Identity</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm text-blue-700 dark:text-blue-300">
              <p className="font-medium mb-1">Verification enables:</p>
              <ul className="space-y-0.5 text-xs">
                <li>• BadgeCheck mark on your profile</li>
                <li>• Access to premium deal rooms</li>
                <li>• Higher visibility in buyer/seller matching</li>
              </ul>
            </div>
            <div className="space-y-1.5">
              <Label>Self-Attestation Statement</Label>
              <Textarea
                placeholder="I confirm that I am a legitimate real estate investor operating legally in my jurisdiction. I agree to AcreOS Marketplace Terms of Service and will conduct all transactions lawfully..."
                value={selfAttestation}
                onChange={e => setSelfAttestation(e.target.value)}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">By submitting, you attest to your identity and legal status as an investor.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyOpen(false)}>Cancel</Button>
            <Button
              onClick={() => verifyMutation.mutate()}
              disabled={selfAttestation.length < 50 || verifyMutation.isPending}
            >
              {verifyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <BadgeCheck className="h-4 w-4 mr-2" />}
              Submit Verification
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
