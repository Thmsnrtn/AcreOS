import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { 
  Phone, 
  Plus, 
  Trash2, 
  Search,
  Star,
  MessageSquare,
  PhoneCall,
  Image
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface PhoneNumber {
  id: number;
  organizationId: number;
  phoneNumber: string;
  twilioSid: string | null;
  friendlyName: string | null;
  capabilities: {
    sms: boolean;
    mms: boolean;
    voice: boolean;
  } | null;
  status: string;
  isDefault: boolean | null;
  purchasedAt: string | null;
  createdAt: string;
}

interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
  capabilities: {
    sms: boolean;
    mms: boolean;
    voice: boolean;
  };
}

export function PhoneNumbersSettings() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [areaCode, setAreaCode] = useState("");
  const [searchContains, setSearchContains] = useState("");
  const [selectedNumber, setSelectedNumber] = useState<AvailableNumber | null>(null);

  const { data: phoneNumbers = [], isLoading } = useQuery<PhoneNumber[]>({
    queryKey: ["/api/phone-numbers"],
  });

  const { data: availableNumbers = [], isFetching: isSearching, refetch: searchNumbers } = useQuery<AvailableNumber[]>({
    queryKey: ["/api/phone-numbers/available", areaCode, searchContains],
    enabled: false,
  });

  const searchMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams();
      if (areaCode) params.set("areaCode", areaCode);
      if (searchContains) params.set("contains", searchContains);
      const response = await fetch(`/api/phone-numbers/available?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to search numbers");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/phone-numbers/available", areaCode, searchContains], data);
    },
    onError: (err: any) => {
      toast({ title: "Search failed", description: err.message, variant: "destructive" });
    },
  });

  const purchaseMutation = useMutation({
    mutationFn: async (data: { phoneNumber: string; friendlyName?: string }) => {
      const res = await apiRequest("POST", "/api/phone-numbers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/phone-numbers"] });
      setIsAddDialogOpen(false);
      setSelectedNumber(null);
      setAreaCode("");
      setSearchContains("");
      toast({ title: "Phone number purchased", description: "Your new phone number is ready to use." });
    },
    onError: (err: any) => {
      toast({ title: "Purchase failed", description: err.message, variant: "destructive" });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (phoneId: number) => {
      const res = await apiRequest("PATCH", `/api/phone-numbers/${phoneId}`, { isDefault: true });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/phone-numbers"] });
      toast({ title: "Default number updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (phoneId: number) => {
      const res = await apiRequest("DELETE", `/api/phone-numbers/${phoneId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/phone-numbers"] });
      toast({ title: "Phone number released" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to release", description: err.message, variant: "destructive" });
    },
  });

  const formatPhoneNumber = (phone: string) => {
    if (phone.startsWith("+1") && phone.length === 12) {
      return `(${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`;
    }
    return phone;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Phone className="w-5 h-5" />
              Phone Numbers
            </CardTitle>
            <CardDescription>
              Purchase phone numbers to send SMS messages from your business
            </CardDescription>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
            setIsAddDialogOpen(open);
            if (!open) {
              setSelectedNumber(null);
              setAreaCode("");
              setSearchContains("");
            }
          }}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-phone">
                <Plus className="w-4 h-4 mr-1" /> Add Number
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Purchase Phone Number</DialogTitle>
                <DialogDescription>
                  Search for available phone numbers and purchase one for your organization.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label htmlFor="areaCode">Area Code</Label>
                    <Input
                      id="areaCode"
                      placeholder="415"
                      value={areaCode}
                      onChange={(e) => setAreaCode(e.target.value)}
                      maxLength={3}
                      data-testid="input-area-code"
                    />
                  </div>
                  <div className="flex-1">
                    <Label htmlFor="contains">Contains</Label>
                    <Input
                      id="contains"
                      placeholder="1234"
                      value={searchContains}
                      onChange={(e) => setSearchContains(e.target.value)}
                      data-testid="input-contains"
                    />
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => searchMutation.mutate()}
                  disabled={searchMutation.isPending}
                  data-testid="button-search-numbers"
                >
                  <Search className="w-4 h-4 mr-2" />
                  {searchMutation.isPending ? "Searching..." : "Search Available Numbers"}
                </Button>

                {searchMutation.data && (searchMutation.data as AvailableNumber[]).length > 0 && (
                  <div className="border rounded-md max-h-60 overflow-y-auto">
                    {(searchMutation.data as AvailableNumber[]).map((num) => (
                      <div
                        key={num.phoneNumber}
                        className={`p-3 border-b last:border-b-0 cursor-pointer hover-elevate ${
                          selectedNumber?.phoneNumber === num.phoneNumber ? "bg-accent" : ""
                        }`}
                        onClick={() => setSelectedNumber(num)}
                        data-testid={`option-phone-${num.phoneNumber}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="font-medium">{formatPhoneNumber(num.phoneNumber)}</div>
                            <div className="text-xs text-muted-foreground">
                              {num.locality}, {num.region}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            {num.capabilities.sms && (
                              <Badge variant="outline" className="text-xs">
                                <MessageSquare className="w-3 h-3" />
                              </Badge>
                            )}
                            {num.capabilities.mms && (
                              <Badge variant="outline" className="text-xs">
                                <Image className="w-3 h-3" />
                              </Badge>
                            )}
                            {num.capabilities.voice && (
                              <Badge variant="outline" className="text-xs">
                                <PhoneCall className="w-3 h-3" />
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {searchMutation.data && (searchMutation.data as AvailableNumber[]).length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    No numbers found. Try a different area code or search term.
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => selectedNumber && purchaseMutation.mutate({
                    phoneNumber: selectedNumber.phoneNumber,
                    friendlyName: selectedNumber.friendlyName,
                  })}
                  disabled={!selectedNumber || purchaseMutation.isPending}
                  data-testid="button-confirm-purchase"
                >
                  {purchaseMutation.isPending ? "Purchasing..." : "Purchase Number"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading phone numbers...</div>
        ) : phoneNumbers.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No phone numbers yet. Purchase a number to send SMS messages.
          </div>
        ) : (
          <div className="space-y-3">
            {phoneNumbers.map((phone) => (
              <div key={phone.id} className="border rounded-md p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium font-mono" data-testid={`text-phone-${phone.id}`}>
                      {formatPhoneNumber(phone.phoneNumber)}
                    </span>
                    <Badge variant={phone.status === "active" ? "default" : "secondary"}>
                      {phone.status}
                    </Badge>
                    {phone.isDefault && (
                      <Badge variant="outline" className="text-xs">
                        <Star className="w-3 h-3 mr-1" /> Default
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {phone.capabilities && (
                      <div className="flex gap-1 mr-2">
                        {phone.capabilities.sms && (
                          <Badge variant="outline" className="text-xs">SMS</Badge>
                        )}
                        {phone.capabilities.mms && (
                          <Badge variant="outline" className="text-xs">MMS</Badge>
                        )}
                        {phone.capabilities.voice && (
                          <Badge variant="outline" className="text-xs">Voice</Badge>
                        )}
                      </div>
                    )}
                    {!phone.isDefault && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDefaultMutation.mutate(phone.id)}
                        data-testid={`button-set-default-${phone.id}`}
                      >
                        <Star className="w-4 h-4 mr-1" />
                        Set Default
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(phone.id)}
                      data-testid={`button-delete-phone-${phone.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                {phone.friendlyName && (
                  <div className="text-sm text-muted-foreground mt-1">
                    {phone.friendlyName}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
