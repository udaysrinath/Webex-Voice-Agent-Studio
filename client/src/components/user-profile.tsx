import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, UserRound } from "lucide-react";
import { webexApi } from "@/lib/api";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const MASKED_BEARER_TOKEN = "••••••••••••••••";

export function UserProfile() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [bearerToken, setBearerToken] = useState("");
  const [bearerTokenChanged, setBearerTokenChanged] = useState(false);
  const [webexSpaceId, setWebexSpaceId] = useState("");
  const [demoCustomerPhone, setDemoCustomerPhone] = useState("");

  const { data: profile } = useQuery({
    queryKey: ["webex-profile"],
    queryFn: webexApi.getProfile,
  });

  useEffect(() => {
    if (profile) {
      setBearerToken(profile.hasBearerToken ? MASKED_BEARER_TOKEN : "");
      setBearerTokenChanged(false);
      setWebexSpaceId(profile.webexSpaceId || "");
      setDemoCustomerPhone(profile.demoCustomerPhone || "");
    }
  }, [profile]);

  const saveProfileMutation = useMutation({
    mutationFn: () => {
      const trimmedBearerToken = bearerToken.trim();
      return webexApi.updateProfile({
        ...(bearerTokenChanged && trimmedBearerToken && trimmedBearerToken !== MASKED_BEARER_TOKEN
          ? { bearerToken: trimmedBearerToken }
          : {}),
        webexSpaceId: webexSpaceId.trim(),
        demoCustomerPhone: demoCustomerPhone.trim(),
      });
    },
    onSuccess: () => {
      setBearerTokenChanged(false);
      queryClient.invalidateQueries({ queryKey: ["webex-profile"] });
      queryClient.invalidateQueries({ queryKey: ["webex-stats"] });
      setOpen(false);
      toast({
        title: "Webex profile saved",
        description: "Messages and demo caller profile settings were saved.",
      });
    },
    onError: (error) => {
      toast({
        title: "Profile save failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="fixed right-4 top-4 z-[60] h-11 w-11 rounded-full border border-white/15 bg-background/70 p-0 shadow-lg shadow-black/20 backdrop-blur-md hover:bg-white/[0.07]"
        onClick={() => setOpen(true)}
        aria-label="Open user profile"
        data-testid="button-user-profile"
      >
        <Avatar className="h-9 w-9 border border-white/15">
          <AvatarFallback className="bg-white/[0.06] text-foreground">
            <UserRound className="h-5 w-5" />
          </AvatarFallback>
        </Avatar>
        {profile?.hasBearerToken && profile.webexSpaceId ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-black">
            <Check className="h-3 w-3" />
          </span>
        ) : null}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[440px]" data-testid="dialog-user-profile">
          <DialogHeader>
            <DialogTitle>User Profile</DialogTitle>
            <DialogDescription>Set Webex credentials and demo caller profile values.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="webex-bearer-token">Webex bearer token</Label>
              <Input
                id="webex-bearer-token"
                type="password"
                value={bearerToken}
                onFocus={(event) => {
                  if (profile?.hasBearerToken && !bearerTokenChanged) {
                    event.currentTarget.select();
                  }
                }}
                onChange={(event) => {
                  setBearerTokenChanged(true);
                  setBearerToken(event.target.value);
                }}
                placeholder={profile?.hasBearerToken ? "Saved token" : "Bearer token"}
                autoComplete="off"
                data-testid="input-webex-bearer-token"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="webex-space-id">WebexSpaceId</Label>
              <Input
                id="webex-space-id"
                value={webexSpaceId}
                onChange={(event) => setWebexSpaceId(event.target.value)}
                placeholder="Webex space id"
                autoComplete="off"
                data-testid="input-webex-space-id"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="demo-customer-phone">Demo customer phone</Label>
              <Input
                id="demo-customer-phone"
                value={demoCustomerPhone}
                onChange={(event) => setDemoCustomerPhone(event.target.value)}
                placeholder="+16505550142"
                autoComplete="tel"
                inputMode="tel"
                data-testid="input-demo-customer-phone"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => saveProfileMutation.mutate()}
              disabled={saveProfileMutation.isPending}
              data-testid="button-save-user-profile"
            >
              {saveProfileMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
