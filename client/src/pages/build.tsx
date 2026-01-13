import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Play, Mic, Cpu, Globe, User, Sparkles, Loader2, Square, MessageSquare, RefreshCw, Send, Code, Copy, ChevronDown, ChevronUp, Wrench, Link2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi, ttsApi, webexApi, type TTSRequest } from "@/lib/api";
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
  const queryClient = useQueryClient();
  
  const [agentName, setAgentName] = useState("Agent Alpha-1");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [selectedLLM, setSelectedLLM] = useState(LLMS[0].id);
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0].id);
  const [language, setLanguage] = useState("en-US");
  const [gender, setGender] = useState("neutral");
  
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [messageText, setMessageText] = useState("");
  const [showFunctionCode, setShowFunctionCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [activeKbTab, setActiveKbTab] = useState<'tools' | 'integrations'>('tools');
  const [showAddTool, setShowAddTool] = useState(false);
  const [showAddIntegration, setShowAddIntegration] = useState(false);
  const [newToolName, setNewToolName] = useState("");
  const [newToolDescription, setNewToolDescription] = useState("");
  const [newIntegrationName, setNewIntegrationName] = useState("");
  const [tools, setTools] = useState<Array<{name: string; description: string}>>([
    { name: "send_webex_message", description: "Send a message to a Webex space/room" }
  ]);
  const [customIntegrations, setCustomIntegrations] = useState<Array<{name: string; status: string}>>([]);

  const { data: webexStats } = useQuery({
    queryKey: ["webex-stats"],
    queryFn: () => webexApi.getStats(),
  });

  const { data: webexRooms = [] } = useQuery({
    queryKey: ["webex-rooms"],
    queryFn: () => webexApi.getRooms(),
    enabled: !!webexStats?.hasToken,
  });

  const syncWebexMutation = useMutation({
    mutationFn: (days: number) => webexApi.sync(days),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["webex-stats"] });
      queryClient.invalidateQueries({ queryKey: ["webex-rooms"] });
      toast({
        title: "Webex Sync Complete",
        description: `Synced ${result.messagesSynced} messages from ${result.roomsSynced} rooms.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: (data: { roomId: string; text: string }) => webexApi.sendMessage(data),
    onSuccess: () => {
      setMessageText("");
      toast({
        title: "Message Sent",
        description: "Your message was sent to the Webex space.",
      });
    },
    onError: (error) => {
      toast({
        title: "Send Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSendMessage = () => {
    if (!selectedRoomId || !messageText.trim()) return;
    sendMessageMutation.mutate({ roomId: selectedRoomId, text: messageText.trim() });
  };

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

  const handleCopyCode = async (code: string, id: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const functionCallingCode = {
    toolDefinition: `const webexTools = [
  {
    type: "function",
    function: {
      name: "send_webex_message",
      description: "Send a message to a Webex space/room",
      parameters: {
        type: "object",
        properties: {
          roomTitle: {
            type: "string",
            description: "The title/name of the Webex room"
          },
          message: {
            type: "string", 
            description: "The message content to send"
          }
        },
        required: ["roomTitle", "message"]
      }
    }
  }
];`,
    apiCall: `const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage }
  ],
  tools: webexTools,
  tool_choice: "auto"
});`,
    handleToolCall: `if (response.choices[0].message.tool_calls) {
  for (const toolCall of response.choices[0].message.tool_calls) {
    if (toolCall.function.name === "send_webex_message") {
      const args = JSON.parse(toolCall.function.arguments);
      const result = await sendWebexMessage(
        args.roomTitle, 
        args.message
      );
      // Continue conversation with tool result
    }
  }
}`
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

          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center text-green-400">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-semibold">Knowledge Base</h2>
                <p className="text-muted-foreground text-sm">Configure tools and integrations for your agent.</p>
              </div>
            </div>

            <div className="bg-card/30 rounded-2xl border border-white/5">
              <div className="flex border-b border-white/5">
                <button
                  onClick={() => setActiveKbTab('tools')}
                  className={`flex-1 px-6 py-4 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                    activeKbTab === 'tools' 
                      ? 'text-primary border-b-2 border-primary bg-primary/5' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  data-testid="tab-tools"
                >
                  <Wrench className="w-4 h-4" />
                  Tools
                </button>
                <button
                  onClick={() => setActiveKbTab('integrations')}
                  className={`flex-1 px-6 py-4 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                    activeKbTab === 'integrations' 
                      ? 'text-primary border-b-2 border-primary bg-primary/5' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  data-testid="tab-integrations"
                >
                  <Link2 className="w-4 h-4" />
                  Integrations
                </button>
              </div>

              <div className="p-6">
                {activeKbTab === 'tools' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Agent Tools</p>
                        <p className="text-sm text-muted-foreground">
                          Functions your agent can call to perform actions.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAddTool(!showAddTool)}
                        data-testid="button-add-tool"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Tool
                      </Button>
                    </div>

                    {showAddTool && (
                      <div className="p-4 bg-background/50 rounded-lg border border-white/10 space-y-3">
                        <div className="space-y-2">
                          <Label className="text-sm">Tool Name</Label>
                          <Input
                            value={newToolName}
                            onChange={(e) => setNewToolName(e.target.value)}
                            placeholder="e.g., get_weather"
                            className="bg-background border-white/10"
                            data-testid="input-tool-name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Description</Label>
                          <Textarea
                            value={newToolDescription}
                            onChange={(e) => setNewToolDescription(e.target.value)}
                            placeholder="What does this tool do?"
                            className="bg-background border-white/10 min-h-[60px]"
                            data-testid="input-tool-description"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowAddTool(false);
                              setNewToolName("");
                              setNewToolDescription("");
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              if (newToolName && newToolDescription) {
                                setTools([...tools, { name: newToolName, description: newToolDescription }]);
                                setNewToolName("");
                                setNewToolDescription("");
                                setShowAddTool(false);
                              }
                            }}
                            disabled={!newToolName || !newToolDescription}
                            data-testid="button-save-tool"
                          >
                            Save Tool
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      {tools.map((tool, index) => (
                        <div 
                          key={index}
                          className="flex items-center justify-between p-3 bg-background/30 rounded-lg border border-white/5"
                          data-testid={`tool-item-${index}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                              <Wrench className="w-4 h-4 text-green-400" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{tool.name}</p>
                              <p className="text-xs text-muted-foreground">{tool.description}</p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-red-400"
                            onClick={() => setTools(tools.filter((_, i) => i !== index))}
                            data-testid={`button-delete-tool-${index}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                      {tools.length === 0 && (
                        <div className="text-center py-6 text-muted-foreground">
                          <Wrench className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No tools configured yet</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeKbTab === 'integrations' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Connected Services</p>
                        <p className="text-sm text-muted-foreground">
                          External services your agent can access.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAddIntegration(!showAddIntegration)}
                        data-testid="button-add-integration"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Integration
                      </Button>
                    </div>

                    {showAddIntegration && (
                      <div className="p-4 bg-background/50 rounded-lg border border-white/10 space-y-3">
                        <div className="space-y-2">
                          <Label className="text-sm">Integration Name</Label>
                          <Input
                            value={newIntegrationName}
                            onChange={(e) => setNewIntegrationName(e.target.value)}
                            placeholder="e.g., Slack, Google Calendar"
                            className="bg-background border-white/10"
                            data-testid="input-integration-name"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowAddIntegration(false);
                              setNewIntegrationName("");
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              if (newIntegrationName) {
                                setCustomIntegrations([...customIntegrations, { name: newIntegrationName, status: "pending" }]);
                                toast({
                                  title: "Integration Added",
                                  description: `${newIntegrationName} has been added. Configure credentials in settings.`,
                                });
                                setNewIntegrationName("");
                                setShowAddIntegration(false);
                              }
                            }}
                            disabled={!newIntegrationName}
                            data-testid="button-save-integration"
                          >
                            Add Integration
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div 
                        className="flex items-center justify-between p-3 bg-background/30 rounded-lg border border-white/5"
                        data-testid="integration-webex"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                            <MessageSquare className="w-4 h-4 text-blue-400" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">Webex</p>
                            <p className="text-xs text-muted-foreground">
                              {webexStats?.hasToken 
                                ? `${webexStats.messageCount} messages from ${webexStats.roomCount} rooms`
                                : "Not configured"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {webexStats?.hasToken ? (
                            <>
                              <span className="text-xs text-green-400 flex items-center gap-1">
                                <Check className="w-3 h-3" />
                                Connected
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => syncWebexMutation.mutate(15)}
                                disabled={syncWebexMutation.isPending}
                                data-testid="button-sync-webex"
                              >
                                {syncWebexMutation.isPending ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-4 h-4" />
                                )}
                              </Button>
                            </>
                          ) : (
                            <span className="text-xs text-yellow-400">Configure token</span>
                          )}
                        </div>
                      </div>

                      {customIntegrations.map((integration, index) => (
                        <div 
                          key={index}
                          className="flex items-center justify-between p-3 bg-background/30 rounded-lg border border-white/5"
                          data-testid={`integration-custom-${index}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center">
                              <Link2 className="w-4 h-4 text-purple-400" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{integration.name}</p>
                              <p className="text-xs text-muted-foreground">Configure credentials</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-yellow-400">Pending setup</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-red-400"
                              onClick={() => setCustomIntegrations(customIntegrations.filter((_, i) => i !== index))}
                              data-testid={`button-delete-integration-${index}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}

                      {webexStats?.hasToken && webexRooms.length > 0 && (
                        <div className="p-4 bg-background/30 rounded-lg border border-white/5 space-y-3">
                          <Label className="text-sm font-medium">Quick Send to Webex</Label>
                          <Select value={selectedRoomId} onValueChange={setSelectedRoomId}>
                            <SelectTrigger className="w-full bg-background border-white/10" data-testid="select-webex-room">
                              <SelectValue placeholder="Select a space..." />
                            </SelectTrigger>
                            <SelectContent className="max-h-60 overflow-y-auto">
                              {webexRooms.map((room) => (
                                <SelectItem key={room.id} value={room.id} className="truncate">
                                  {room.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          
                          {selectedRoomId && (
                            <div className="space-y-2">
                              <Textarea
                                value={messageText}
                                onChange={(e) => setMessageText(e.target.value)}
                                placeholder="Type your message..."
                                className="min-h-[60px] bg-background border-white/10 resize-none"
                                data-testid="input-webex-message"
                              />
                              <div className="flex justify-end">
                                <Button
                                  size="sm"
                                  onClick={handleSendMessage}
                                  disabled={sendMessageMutation.isPending || !messageText.trim()}
                                  data-testid="button-send-webex-message"
                                >
                                  {sendMessageMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <>
                                      <Send className="w-4 h-4 mr-2" />
                                      Send
                                    </>
                                  )}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-400">
                <Code className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-semibold">Function Calling</h2>
                <p className="text-muted-foreground text-sm">Enable your agent to execute actions like sending Webex messages.</p>
              </div>
            </div>

            <div className="bg-card/30 p-6 rounded-2xl border border-white/5">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">OpenAI Function Calling</p>
                    <p className="text-sm text-muted-foreground">
                      Your agent can send Webex messages when asked using natural language.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFunctionCode(!showFunctionCode)}
                    data-testid="button-toggle-function-code"
                  >
                    {showFunctionCode ? (
                      <>
                        <ChevronUp className="w-4 h-4 mr-2" />
                        Hide Code
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4 mr-2" />
                        View Sample Code
                      </>
                    )}
                  </Button>
                </div>

                {showFunctionCode && (
                  <div className="space-y-4 pt-4 border-t border-white/5">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium text-orange-400">1. Define the Tool</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => handleCopyCode(functionCallingCode.toolDefinition, 'tool')}
                          data-testid="button-copy-tool-code"
                        >
                          {copiedCode === 'tool' ? (
                            <Check className="w-3 h-3 text-green-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                      <pre className="bg-black/50 rounded-lg p-4 overflow-x-auto text-xs text-green-400 font-mono">
                        <code>{functionCallingCode.toolDefinition}</code>
                      </pre>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium text-orange-400">2. Call the API with Tools</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => handleCopyCode(functionCallingCode.apiCall, 'api')}
                          data-testid="button-copy-api-code"
                        >
                          {copiedCode === 'api' ? (
                            <Check className="w-3 h-3 text-green-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                      <pre className="bg-black/50 rounded-lg p-4 overflow-x-auto text-xs text-green-400 font-mono">
                        <code>{functionCallingCode.apiCall}</code>
                      </pre>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium text-orange-400">3. Handle Tool Calls</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => handleCopyCode(functionCallingCode.handleToolCall, 'handle')}
                          data-testid="button-copy-handle-code"
                        >
                          {copiedCode === 'handle' ? (
                            <Check className="w-3 h-3 text-green-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                      <pre className="bg-black/50 rounded-lg p-4 overflow-x-auto text-xs text-green-400 font-mono">
                        <code>{functionCallingCode.handleToolCall}</code>
                      </pre>
                    </div>

                    <div className="pt-3 border-t border-white/5">
                      <p className="text-xs text-muted-foreground">
                        When you chat with your agent, it can automatically detect when you want to send a message 
                        and execute the action on your behalf.
                      </p>
                    </div>
                  </div>
                )}
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
