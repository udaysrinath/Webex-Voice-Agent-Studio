import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Mic, BarChart2, ArrowRight, Radio, Layers, Bot, Trash2, User, Globe, Cpu, MessageSquare, Pencil, PhoneCall } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { agentsApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Agent, InsertAgent } from "@shared/schema";
import heroBg from "@assets/generated_images/Abstract_sound_waves_visualization_010bae0d.png";

const FALLBACK_LLM_OPTIONS = [
  { value: "gpt-4o", label: "GPT-4o (OpenAI)" },
];

const FALLBACK_VOICE_OPTIONS = [
  { value: "alloy", label: "Alloy" },
];

const LANGUAGE_OPTIONS = [
  { value: "English", label: "English" },
  { value: "Spanish", label: "Spanish" },
  { value: "French", label: "French" },
  { value: "German", label: "German" },
  { value: "Japanese", label: "Japanese" },
  { value: "Chinese", label: "Chinese" },
];

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "neutral", label: "Neutral" },
];

function getModelLabel(agent: Agent, providerConfig: any): string {
  const model = providerConfig?.llmModels?.find((item: any) => item.id === agent.llmModel);
  return model ? `${model.name} (${model.provider})` : agent.llmModel;
}

function getVoiceDisplay(agent: Agent, providerConfig: any): { name: string; detail: string } {
  const voice = providerConfig?.voices?.find((item: any) => item.id === agent.voiceModel);
  if (!voice) {
    return { name: agent.voiceModel, detail: "Voice profile" };
  }

  const detail = [voice.style, voice.gender].filter(Boolean).join(" · ");
  return {
    name: voice.name,
    detail: detail || agent.voiceModel,
  };
}

function getPromptPreview(prompt: string): string {
  return prompt
    .replace(/^#+\s*/gm, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function Home() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    systemPrompt: "",
    llmModel: "",
    voiceModel: "",
    language: "",
    gender: "",
  });
  
  const { data: providerConfig } = useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      return res.json();
    },
  });

  const LLM_OPTIONS = providerConfig?.llmModels?.map((m: any) => ({ value: m.id, label: `${m.name} (${m.provider})` })) || FALLBACK_LLM_OPTIONS;
  const VOICE_OPTIONS = providerConfig?.voices?.map((v: any) => ({ value: v.id, label: v.name })) || FALLBACK_VOICE_OPTIONS;

  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: agentsApi.getAll,
  });

  const deleteAgentMutation = useMutation({
    mutationFn: (id: number) => agentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      toast({
        title: "Agent Deleted",
        description: "The agent has been removed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateAgentMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<InsertAgent> }) => 
      agentsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      setEditingAgent(null);
      toast({
        title: "Agent Updated",
        description: "Your changes have been saved.",
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEditClick = (agent: Agent) => {
    setLocation(`/build?agentId=${agent.id}`);
  };

  const handleSaveEdit = () => {
    if (!editingAgent) return;
    updateAgentMutation.mutate({
      id: editingAgent.id,
      data: editForm,
    });
  };

  const latestAgent = agents.length > 0 ? agents[agents.length - 1] : null;

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden font-sans">
      <div className="absolute inset-0 z-0 opacity-20">
        <img 
          src={heroBg} 
          alt="Background" 
          className="w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
      </div>

      <div className="relative z-10 container mx-auto px-4 py-20 flex flex-col items-center justify-center min-h-screen">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16 max-w-3xl"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-6">
            <Bot className="w-4 h-4" />
            <span>Next-Gen Voice Agents</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-display font-bold mb-6 tracking-tight leading-tight">
            Webex <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-400">Voice Agent Studio</span>
          </h1>
          <p className="text-xl text-muted-foreground leading-relaxed">
            Design personalized voice agents for the Webex ecosystem. 
            Build custom personas and evaluate speech quality in real-time.
          </p>
          {agents.length > 0 && (
            <p className="text-sm text-muted-foreground mt-4" data-testid="text-agent-count">
              {agents.length} agent{agents.length !== 1 ? 's' : ''} created
            </p>
          )}
        </motion.div>

        <div className="grid md:grid-cols-2 gap-8 w-full max-w-4xl">
          <Link href="/build">
            <motion.div 
              whileHover={{ scale: 1.02, translateY: -5 }}
              whileTap={{ scale: 0.98 }}
              className="group cursor-pointer relative overflow-hidden rounded-3xl border border-white/10 bg-card/50 backdrop-blur-sm p-8 hover:bg-card/80 transition-all duration-300 shadow-lg hover:shadow-primary/20 hover:border-primary/50"
              data-testid="card-build-mode"
            >
              <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                <Layers className="w-32 h-32 -mt-10 -mr-10" />
              </div>
              
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center mb-6 shadow-lg shadow-blue-500/20">
                <Mic className="w-7 h-7 text-white" />
              </div>
              
              <h2 className="text-2xl font-display font-bold mb-3 group-hover:text-primary transition-colors">Build Agent</h2>
              <p className="text-muted-foreground mb-8">
                Configure voice, language, gender, and LLM backend to create a unique podcasting persona.
              </p>
              
              <div className="flex items-center text-sm font-medium text-primary group-hover:translate-x-1 transition-transform">
                Start Building <ArrowRight className="w-4 h-4 ml-2" />
              </div>
            </motion.div>
          </Link>

          <Link href={latestAgent ? `/evaluate?agentId=${latestAgent.id}` : "/build"}>
            <motion.div 
              whileHover={{ scale: 1.02, translateY: -5 }}
              whileTap={{ scale: 0.98 }}
              className="group cursor-pointer relative overflow-hidden rounded-3xl border border-white/10 bg-card/50 backdrop-blur-sm p-8 hover:bg-card/80 transition-all duration-300 shadow-lg hover:shadow-purple-500/20 hover:border-purple-500/50"
              data-testid="card-evaluate-mode"
            >
              <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                <Radio className="w-32 h-32 -mt-10 -mr-10" />
              </div>
              
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-400 flex items-center justify-center mb-6 shadow-lg shadow-purple-500/20">
                <BarChart2 className="w-7 h-7 text-white" />
              </div>
              
              <h2 className="text-2xl font-display font-bold mb-3 group-hover:text-purple-400 transition-colors">Evaluate</h2>
              <p className="text-muted-foreground mb-8">
                Test text-to-speech quality attributes, naturalness, and analyze agent responses.
              </p>
              
              <div className="flex items-center text-sm font-medium text-purple-400 group-hover:translate-x-1 transition-transform">
                {latestAgent ? `Evaluate ${latestAgent.name}` : "Create an Agent First"} <ArrowRight className="w-4 h-4 ml-2" />
              </div>
            </motion.div>
          </Link>
        </div>

        {agents.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="w-full max-w-6xl mt-16"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-display font-bold">Your Agents</h2>
              <span className="text-sm text-muted-foreground">{agents.length} agent{agents.length !== 1 ? 's' : ''}</span>
            </div>
            
            <div className="grid gap-4">
              {agents.map((agent) => {
                const modelLabel = getModelLabel(agent, providerConfig);
                const voiceDisplay = getVoiceDisplay(agent, providerConfig);
                const promptPreview = getPromptPreview(agent.systemPrompt || "");

                return (
                <Card 
                  key={agent.id} 
                  className="p-6 bg-card/50 backdrop-blur-sm border-white/10 hover:border-white/20 transition-colors"
                  data-testid={`card-agent-${agent.id}`}
                >
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-stretch">
                    <div className="flex-1 min-w-0">
                      <div className="mb-5 flex items-center gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-purple-500/20">
                          <Bot className="h-6 w-6 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-lg" data-testid={`text-agent-name-${agent.id}`}>{agent.name}</h3>
                          <p className="text-xs text-muted-foreground">
                            Created {new Date(agent.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      
                      <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                        <div className="flex min-h-[86px] items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-muted-foreground">
                          <Cpu className="mt-0.5 h-4 w-4 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">Model</p>
                            <p className="break-words font-medium text-foreground/90" data-testid={`text-agent-llm-${agent.id}`}>{modelLabel}</p>
                          </div>
                        </div>
                        <div className="flex min-h-[86px] items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-muted-foreground">
                          <Mic className="mt-0.5 h-4 w-4 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">Voice</p>
                            <p className="break-words font-medium text-foreground/90" data-testid={`text-agent-voice-${agent.id}`}>{voiceDisplay.name}</p>
                            <p className="mt-0.5 break-words text-xs capitalize">{voiceDisplay.detail}</p>
                          </div>
                        </div>
                        <div className="flex min-h-[86px] items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-muted-foreground">
                          <Globe className="mt-0.5 h-4 w-4 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">Language</p>
                            <p className="break-words font-medium text-foreground/90" data-testid={`text-agent-language-${agent.id}`}>{agent.language}</p>
                          </div>
                        </div>
                        <div className="flex min-h-[86px] items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-muted-foreground">
                          <User className="mt-0.5 h-4 w-4 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">Persona</p>
                            <p className="break-words font-medium capitalize text-foreground/90" data-testid={`text-agent-gender-${agent.id}`}>{agent.gender}</p>
                          </div>
                        </div>
                      </div>

                      {promptPreview && (
                        <div className="mt-3 flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-muted-foreground">
                          <MessageSquare className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground/80">Description</p>
                            <p className="line-clamp-4 leading-relaxed" data-testid={`text-agent-prompt-${agent.id}`}>{promptPreview}</p>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex flex-col gap-3 border-white/10 xl:border-l xl:pl-6">
                      <Button
                        variant="outline"
                        className="h-11 w-full justify-start gap-3 px-3"
                        onClick={() => handleEditClick(agent)}
                        data-testid={`button-edit-agent-${agent.id}`}
                      >
                        <Pencil className="h-4 w-4 shrink-0" />
                        Edit
                      </Button>
                      <Link href={`/evaluate?agentId=${agent.id}`} className="w-full">
                        <Button 
                          variant="outline" 
                          className="min-h-[82px] w-full justify-start gap-3 px-3 py-3 text-left"
                          data-testid={`button-evaluate-agent-${agent.id}`}
                        >
                          <Mic className="h-5 w-5 shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">Call in browser</span>
                            <span className="block whitespace-normal text-xs font-normal text-muted-foreground">
                              Use this browser microphone and live transcript.
                            </span>
                          </span>
                        </Button>
                      </Link>
                      <Link href="/pstn-call?agentId=1" className="w-full">
                        <Button
                          variant="outline"
                          className="min-h-[82px] w-full justify-start gap-3 border-green-500/30 px-3 py-3 text-left text-green-300"
                          data-testid={`button-pstn-call-agent-${agent.id}`}
                        >
                          <PhoneCall className="h-5 w-5 shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">Call by phone</span>
                            <span className="block whitespace-normal text-xs font-normal text-green-200/70">
                              Dial PSTN and monitor the phone transcript.
                            </span>
                          </span>
                        </Button>
                      </Link>
                      <Button 
                        variant="ghost" 
                        className="h-11 w-full justify-start gap-3 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => deleteAgentMutation.mutate(agent.id)}
                        disabled={deleteAgentMutation.isPending}
                        data-testid={`button-delete-agent-${agent.id}`}
                      >
                        <Trash2 className="h-4 w-4 shrink-0" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </Card>
              )})}
            </div>
          </motion.div>
        )}
      </div>

      <Dialog open={!!editingAgent} onOpenChange={(open) => !open && setEditingAgent(null)}>
        <DialogContent className="sm:max-w-[500px]" data-testid="dialog-edit-agent">
          <DialogHeader>
            <DialogTitle>Edit Agent</DialogTitle>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                data-testid="input-edit-name"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-prompt">System Prompt</Label>
              <Textarea
                id="edit-prompt"
                value={editForm.systemPrompt}
                onChange={(e) => setEditForm({ ...editForm, systemPrompt: e.target.value })}
                rows={4}
                placeholder="Describe the persona and behavior of your AI agent..."
                data-testid="input-edit-prompt"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>LLM Model</Label>
                <Select
                  value={editForm.llmModel}
                  onValueChange={(value) => setEditForm({ ...editForm, llmModel: value })}
                >
                  <SelectTrigger data-testid="select-edit-llm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LLM_OPTIONS.map((opt: any) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>Voice Model</Label>
                <Select
                  value={editForm.voiceModel}
                  onValueChange={(value) => setEditForm({ ...editForm, voiceModel: value })}
                >
                  <SelectTrigger data-testid="select-edit-voice">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VOICE_OPTIONS.map((opt: any) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Language</Label>
                <Select
                  value={editForm.language}
                  onValueChange={(value) => setEditForm({ ...editForm, language: value })}
                >
                  <SelectTrigger data-testid="select-edit-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>Gender</Label>
                <Select
                  value={editForm.gender}
                  onValueChange={(value) => setEditForm({ ...editForm, gender: value })}
                >
                  <SelectTrigger data-testid="select-edit-gender">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setEditingAgent(null)}
              data-testid="button-cancel-edit"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit}
              disabled={updateAgentMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateAgentMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
