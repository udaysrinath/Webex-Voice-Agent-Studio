import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Play, Mic, Cpu, Globe, User, Sparkles, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { agentsApi, ttsApi, type TTSRequest } from "@/lib/api";
import type { InsertAgent } from "@shared/schema";

const LLMS = [
  { id: "gpt-4", name: "GPT-4o", provider: "OpenAI", desc: "Best for reasoning & nuance" },
  { id: "claude-3", name: "Claude 3.5 Sonnet", provider: "Anthropic", desc: "Natural & human-like" },
  { id: "gemini-1.5", name: "Gemini 1.5 Pro", provider: "Google", desc: "Fast & large context" },
];

const VOICES = [
  { id: "alloy", name: "Alloy", gender: "Neutral", style: "Balanced" },
  { id: "echo", name: "Echo", gender: "Male", style: "Deep" },
  { id: "fable", name: "Fable", gender: "Male", style: "British" },
  { id: "onyx", name: "Onyx", gender: "Male", style: "Authoritative" },
  { id: "nova", name: "Nova", gender: "Female", style: "Energetic" },
  { id: "shimmer", name: "Shimmer", gender: "Female", style: "Soft" },
];

const VOICE_PREVIEW_TEXT = "Hello! I'm your AI podcaster assistant. Let me help you create engaging content.";

const DEFAULT_SYSTEM_PROMPT = `# Personality

You are Webex Agent, a helpful and efficient personal agent.
You are proactive, organized, and focused on providing relevant information to help the user prepare for their day.
You are knowledgeable about the user's team and their ongoing projects.`;

export default function Build() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [agentName, setAgentName] = useState("Agent Alpha-1");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [selectedLLM, setSelectedLLM] = useState(LLMS[0].id);
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0].id);
  const [language, setLanguage] = useState("en-US");
  const [gender, setGender] = useState("neutral");
  
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const createAgentMutation = useMutation({
    mutationFn: (data: InsertAgent) => agentsApi.create(data),
    onSuccess: (agent) => {
      toast({
        title: "Agent Created Successfully",
        description: "Your podcaster agent is ready for evaluation.",
      });
      setLocation(`/evaluate?agentId=${agent.id}`);
    },
    onError: (error) => {
      toast({
        title: "Error Creating Agent",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleVoicePreview = async (voiceId: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    
    if (playingVoice === voiceId) {
      setPlayingVoice(null);
      return;
    }
    
    setPreviewingVoice(voiceId);
    setPlayingVoice(null);
    
    try {
      const response = await ttsApi.generate({
        text: VOICE_PREVIEW_TEXT,
        voice: voiceId as TTSRequest["voice"],
        model: "tts-1",
      });
      
      const audioData = `data:${response.contentType};base64,${response.audio}`;
      const audio = new Audio(audioData);
      audioRef.current = audio;
      
      audio.onended = () => {
        setPlayingVoice(null);
      };
      
      audio.onerror = () => {
        setPlayingVoice(null);
        toast({
          title: "Playback Error",
          description: "Unable to play the audio preview.",
          variant: "destructive",
        });
      };
      
      await audio.play();
      setPlayingVoice(voiceId);
    } catch (error: any) {
      toast({
        title: "Preview Error",
        description: error.message || "Failed to generate voice preview.",
        variant: "destructive",
      });
    } finally {
      setPreviewingVoice(null);
    }
  };

  const handleCreate = () => {
    createAgentMutation.mutate({
      name: agentName,
      systemPrompt,
      llmModel: selectedLLM,
      voiceModel: selectedVoice,
      language,
      gender,
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans pb-20">
      <header className="border-b border-white/10 bg-background/50 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-primary">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Home
            </Button>
          </Link>
          <h1 className="text-lg font-display font-bold">Build Agent</h1>
          <div className="w-20" />
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 max-w-4xl">
        <div className="space-y-12">
          
          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400">
                <User className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-semibold">Agent Identity</h2>
                <p className="text-muted-foreground text-sm">Give your agent a unique name.</p>
              </div>
            </div>
            
            <div className="space-y-6">
              <div className="space-y-3">
                <Label className="text-base">Agent Name</Label>
                <Input 
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="e.g., Tech Talk Host"
                  className="h-12 bg-background border-white/10"
                  data-testid="input-agent-name"
                />
              </div>
              
              <div className="space-y-3">
                <Label className="text-base">System Prompt</Label>
                <Textarea 
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Define your agent's personality and behavior..."
                  className="min-h-[150px] bg-background border-white/10 resize-y"
                  data-testid="input-system-prompt"
                />
                <p className="text-xs text-muted-foreground">
                  This prompt defines your agent's personality and how it should respond.
                </p>
              </div>
            </div>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-semibold">Intelligence Engine</h2>
                <p className="text-muted-foreground text-sm">Select the LLM that powers your agent's thoughts.</p>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              {LLMS.map((llm) => (
                <div 
                  key={llm.id}
                  onClick={() => setSelectedLLM(llm.id)}
                  className={`cursor-pointer relative rounded-xl border p-5 transition-all duration-200 ${
                    selectedLLM === llm.id 
                      ? "bg-primary/10 border-primary ring-1 ring-primary" 
                      : "bg-card border-border hover:border-primary/50"
                  }`}
                  data-testid={`llm-card-${llm.id}`}
                >
                  {selectedLLM === llm.id && (
                    <div className="absolute top-3 right-3 text-primary">
                      <Check className="w-4 h-4" />
                    </div>
                  )}
                  <div className="font-semibold mb-1">{llm.name}</div>
                  <div className="text-xs text-primary/80 mb-3 uppercase tracking-wider font-medium">{llm.provider}</div>
                  <div className="text-sm text-muted-foreground">{llm.desc}</div>
                </div>
              ))}
            </div>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400">
                <Mic className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-semibold">Persona & Voice</h2>
                <p className="text-muted-foreground text-sm">Define how your agent sounds and speaks.</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8 bg-card/30 p-6 rounded-2xl border border-white/5">
              
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label className="text-base">Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger className="w-full h-12 bg-background border-white/10 focus:ring-primary" data-testid="select-language">
                      <SelectValue placeholder="Select Language" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en-US">English (US)</SelectItem>
                      <SelectItem value="en-GB">English (UK)</SelectItem>
                      <SelectItem value="es-ES">Spanish</SelectItem>
                      <SelectItem value="fr-FR">French</SelectItem>
                      <SelectItem value="de-DE">German</SelectItem>
                      <SelectItem value="ja-JP">Japanese</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <Label className="text-base">Gender Preference</Label>
                  <RadioGroup value={gender} onValueChange={setGender} className="flex gap-4">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="male" id="r1" className="border-white/20 text-primary" />
                      <Label htmlFor="r1" className="cursor-pointer">Male</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="female" id="r2" className="border-white/20 text-primary" />
                      <Label htmlFor="r2" className="cursor-pointer">Female</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="neutral" id="r3" className="border-white/20 text-primary" />
                      <Label htmlFor="r3" className="cursor-pointer">Neutral</Label>
                    </div>
                  </RadioGroup>
                </div>
              </div>

              <div className="space-y-3">
                 <Label className="text-base flex justify-between">
                    <span>Voice Model</span>
                    <span className="text-xs text-muted-foreground font-normal">Click icon to preview</span>
                 </Label>
                 <div className="grid grid-cols-2 gap-3">
                    {VOICES.map(voice => (
                      <div 
                        key={voice.id}
                        onClick={() => setSelectedVoice(voice.id)}
                        className={`p-3 rounded-lg border cursor-pointer flex items-center justify-between group transition-all ${
                          selectedVoice === voice.id 
                            ? "bg-primary/10 border-primary" 
                            : "bg-background border-white/10 hover:border-white/30"
                        }`}
                        data-testid={`voice-card-${voice.id}`}
                      >
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">{voice.name}</span>
                          <span className="text-xs text-muted-foreground">{voice.style}</span>
                        </div>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className={`h-8 w-8 rounded-full ${selectedVoice === voice.id ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground group-hover:text-foreground"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleVoicePreview(voice.id);
                          }}
                          disabled={previewingVoice !== null}
                        >
                          {previewingVoice === voice.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : playingVoice === voice.id ? (
                            <Square className="w-3 h-3 fill-current" />
                          ) : (
                            <Play className="w-3 h-3 fill-current" />
                          )}
                        </Button>
                      </div>
                    ))}
                 </div>
              </div>

            </div>
          </motion.section>
          
          <div className="flex justify-end pt-8 border-t border-white/10">
             <Button 
              size="lg" 
              className="px-8 h-12 text-base font-medium bg-gradient-to-r from-primary to-cyan-400 hover:from-primary/90 hover:to-cyan-400/90 text-black shadow-lg shadow-cyan-500/20"
              onClick={handleCreate}
              disabled={createAgentMutation.isPending || !agentName.trim()}
              data-testid="button-create-agent"
             >
               {createAgentMutation.isPending ? (
                 <>Creating Agent...</>
               ) : (
                 <>Create Agent <Sparkles className="w-4 h-4 ml-2" /></>
               )}
             </Button>
          </div>

        </div>
      </main>
    </div>
  );
}
