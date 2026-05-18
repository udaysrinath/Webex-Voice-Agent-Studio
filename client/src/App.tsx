import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Build from "@/pages/build";
import Evaluate from "@/pages/evaluate";
import PstnCall from "@/pages/pstn-call";
import Preflight from "@/pages/preflight";
import { UserProfile } from "@/components/user-profile";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/build" component={Build} />
      <Route path="/evaluate" component={Evaluate} />
      <Route path="/pstn-call" component={PstnCall} />
      <Route path="/preflight" component={Preflight} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <UserProfile />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
