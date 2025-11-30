import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Mic, MicOff, Play, Pause, Send, Download, Settings2, Star, Loader2, Volume2, MessageCircle, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentsApi, evaluationsApi, ttsApi, chatApi, type TTSRequest } from "@/lib/api";
import type { InsertEvaluation } from "@shared/schema";
import type { ChatMessage } from "@/lib/api";

export default function Evaluate() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const params = new URLSearchParams(search);
  const agentId = params.get("agentId") ? parseInt(params.get("agentId")!) : null;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [inputText, setInputText] = useState("Welcome to the Webex AI Podcaster evaluation. I am ready to assist you.");
  
  const [ratings, setRatings] = useState({
    naturalness: 75,
    clarity: 85,
    intonation: 60,
    speed: 50
  });

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  
  const [isRecording, setIsRecording] = useState(false);
  const [autoPlayVoice, setAutoPlayVoice] = useState(true);
  const recognitionRef = useRef<any>(null);
  const responseAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const finalTranscriptRef = useRef<string>("");

  const { data: agent, isLoading: agentLoading } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => agentId ? agentsApi.getById(agentId) : Promise.reject("No agent ID"),
    enabled: !!agentId,
  });

  const { data: evaluations = [] } = useQuery({
    queryKey: ["evaluations", agentId],
    queryFn: () => agentId ? evaluationsApi.getByAgent(agentId) : Promise.resolve([]),
    enabled: !!agentId,
  });

  const VALID_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;

  const generateTTSMutation = useMutation({
    mutationFn: (data: TTSRequest) => ttsApi.generate(data),
    onSuccess: (response) => {
      const audioData = `data:${response.contentType};base64,${response.audio}`;
      setAudioUrl(audioData);
      setIsPlaying(false);
      setCurrentTime(0);
      setAudioDuration(0);
      toast({
        title: "Audio Generated",
        description: "Click play to listen to the generated speech.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error Generating Audio",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveEvaluationMutation = useMutation({
    mutationFn: (data: InsertEvaluation) => evaluationsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["evaluations", agentId] });
      toast({
        title: "Evaluation Saved",
        description: "Your quality ratings have been recorded.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error Saving Evaluation",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const generateAndPlayAudio = useCallback(async (text: string) => {
    if (!agent) return;
    
    const voice = agent.voiceModel;
    if (!VALID_VOICES.includes(voice as any)) return;
    
    try {
      const response = await ttsApi.generate({
        text,
        voice: voice as TTSRequest["voice"],
        model: "tts-1",
      });
      
      const audioData = `data:${response.contentType};base64,${response.audio}`;
      setAudioUrl(audioData);
      
      if (autoPlayVoice) {
        const audio = new Audio(audioData);
        responseAudioRef.current = audio;
        audio.onended = () => {
          responseAudioRef.current = null;
        };
        await audio.play();
      }
    } catch (error) {
      console.error("Failed to generate audio:", error);
    }
  }, [agent, autoPlayVoice]);

  const chatMutation = useMutation({
    mutationFn: ({ message, history }: { message: string; history: ChatMessage[] }) => chatApi.send({
      message,
      systemPrompt: agent?.systemPrompt,
      agentId: agent?.id,
      history,
    }),
    onSuccess: (response) => {
      setChatMessages(prev => [...prev, { role: "assistant", content: response.response }]);
      setInputText(response.response);
      setAudioUrl(null);
      
      if (autoPlayVoice) {
        generateAndPlayAudio(response.response);
      }
    },
    onError: (error) => {
      toast({
        title: "Chat Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSendChat = () => {
    if (!chatInput.trim() || chatMutation.isPending) return;
    
    const newMessage: ChatMessage = { role: "user", content: chatInput };
    const updatedHistory = [...chatMessages, newMessage];
    setChatMessages(updatedHistory);
    chatMutation.mutate({ message: chatInput, history: chatMessages });
    setChatInput("");
  };

  const startVoiceRecording = useCallback(() => {
    try {
      if (responseAudioRef.current) {
        responseAudioRef.current.pause();
        responseAudioRef.current = null;
      }

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      if (!SpeechRecognition) {
        toast({
          title: "Speech Recognition Not Supported",
          description: "Please use Chrome or Edge browser for voice input.",
          variant: "destructive",
        });
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      
      finalTranscriptRef.current = "";

      recognition.onstart = () => {
        console.log('Speech recognition started');
        setIsRecording(true);
        setChatInput("");
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = finalTranscriptRef.current;
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
            finalTranscriptRef.current = finalTranscript;
          } else {
            interimTranscript += transcript;
          }
        }
        
        setChatInput(finalTranscript + interimTranscript);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          toast({
            title: "Microphone Access Denied",
            description: "Please allow microphone access to use voice input.",
            variant: "destructive",
          });
        } else if (event.error !== 'aborted') {
          toast({
            title: "Speech Recognition Error",
            description: `Error: ${event.error}`,
            variant: "destructive",
          });
        }
        setIsRecording(false);
      };

      recognition.onend = () => {
        console.log('Speech recognition ended');
        setIsRecording(false);
        
        const finalText = finalTranscriptRef.current.trim();
        if (finalText) {
          const currentHistory = chatMessagesRef.current;
          const newMessage: ChatMessage = { role: "user", content: finalText };
          setChatMessages(prev => [...prev, newMessage]);
          chatMutation.mutate({ message: finalText, history: currentHistory });
          setChatInput("");
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (error: any) {
      toast({
        title: "Speech Recognition Error",
        description: error.message || "Could not start speech recognition.",
        variant: "destructive",
      });
    }
  }, [toast, chatMutation]);

  const stopVoiceRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  const handleVoiceToggle = useCallback(() => {
    if (isRecording) {
      stopVoiceRecording();
    } else {
      setChatInput("");
      startVoiceRecording();
    }
  }, [isRecording, startVoiceRecording, stopVoiceRecording]);

  const handleGenerateAudio = () => {
    if (!agent || !inputText.trim()) return;
    
    const voice = agent.voiceModel;
    if (!VALID_VOICES.includes(voice as any)) {
      toast({
        title: "Unsupported Voice",
        description: `The voice "${voice}" is not supported. Please select a valid voice model.`,
        variant: "destructive",
      });
      return;
    }
    
    generateTTSMutation.mutate({
      text: inputText,
      voice: voice as TTSRequest["voice"],
      model: "tts-1",
    });
  };

  const handlePlayPause = async () => {
    if (!audioRef.current || !audioUrl) return;
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (error) {
        toast({
          title: "Playback Error",
          description: "Unable to play audio. Please try again.",
          variant: "destructive",
        });
        setIsPlaying(false);
      }
    }
  };

  const handleSaveEvaluation = () => {
    if (!agentId) return;
    
    saveEvaluationMutation.mutate({
      agentId,
      inputText,
      naturalness: ratings.naturalness,
      clarity: ratings.clarity,
      intonation: ratings.intonation,
      speed: ratings.speed,
    });
  };

  useEffect(() => {
    if (!agentId) {
      setLocation("/");
    }
  }, [agentId, setLocation]);

  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.src = audioUrl;
      audioRef.current.load();
    }
  }, [audioUrl]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (agentLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!agent) {
    return null;
  }

  const avgScore = evaluations.length > 0 
    ? Math.round(
        evaluations.reduce((sum, e) => sum + e.naturalness + e.clarity + e.intonation + e.speed, 0) 
        / (evaluations.length * 4)
      )
    : null;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      <audio 
        ref={audioRef}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setAudioDuration(e.currentTarget.duration)}
        onEnded={() => setIsPlaying(false)}
      />
      
      <header className="border-b border-white/10 bg-background/50 backdrop-blur-md h-16 flex items-center px-6 justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
             <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-cyan-300 flex items-center justify-center">
                <Mic className="w-4 h-4 text-black" />
             </div>
             <div>
               <h1 className="font-display font-bold leading-none" data-testid="text-agent-name">{agent.name}</h1>
               <span className="text-xs text-muted-foreground">
                 {agent.llmModel} • {agent.voiceModel} • {agent.language}
               </span>
             </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
           {avgScore !== null && (
             <Badge className="bg-primary/10 text-primary border-primary/20">
               Avg Score: {avgScore}%
             </Badge>
           )}
           <Button variant="outline" size="sm" className="border-white/10 bg-white/5 hover:bg-white/10">
             <Settings2 className="w-4 h-4 mr-2" /> Settings
           </Button>
           <Button 
             size="sm" 
             className="bg-primary text-primary-foreground hover:bg-primary/90"
             onClick={handleSaveEvaluation}
             disabled={saveEvaluationMutation.isPending}
             data-testid="button-save-evaluation"
           >
             <Download className="w-4 h-4 mr-2" /> 
             {saveEvaluationMutation.isPending ? "Saving..." : "Save Evaluation"}
           </Button>
        </div>
      </header>

      <main className="flex-1 grid lg:grid-cols-12 gap-0 overflow-hidden">
        
        <div className="lg:col-span-7 flex flex-col border-r border-white/10 bg-card/20 p-6 overflow-y-auto">
           <div className="flex-1 space-y-4 overflow-y-auto">
              {chatMessages.length === 0 ? (
                <div className="flex gap-4 max-w-2xl">
                   <Avatar className="h-10 w-10 border border-primary/50">
                      <AvatarFallback className="bg-primary text-black font-bold">AI</AvatarFallback>
                   </Avatar>
                   <div className="space-y-2 flex-1">
                      <div className="text-sm font-medium text-muted-foreground">{agent.name}</div>
                      <div className="p-4 rounded-2xl rounded-tl-none bg-white/5 border border-white/10 text-base leading-relaxed">
                         Hi! I'm {agent.name}. Ask me anything and I'll use your Webex messages as context to provide relevant responses.
                      </div>
                   </div>
                </div>
              ) : (
                chatMessages.map((msg, i) => (
                  <div key={i} className={`flex gap-4 max-w-2xl ${msg.role === "user" ? "ml-auto flex-row-reverse" : ""}`}>
                     <Avatar className="h-10 w-10 border border-primary/50">
                        <AvatarFallback className={msg.role === "user" ? "bg-purple-500 text-white font-bold" : "bg-primary text-black font-bold"}>
                          {msg.role === "user" ? "U" : "AI"}
                        </AvatarFallback>
                     </Avatar>
                     <div className={`space-y-2 flex-1 ${msg.role === "user" ? "items-end" : ""}`}>
                        <div className="text-sm font-medium text-muted-foreground">
                          {msg.role === "user" ? "You" : agent.name}
                        </div>
                        <div className={`p-4 rounded-2xl text-base leading-relaxed ${
                          msg.role === "user" 
                            ? "rounded-tr-none bg-purple-500/10 border border-purple-500/20" 
                            : "rounded-tl-none bg-white/5 border border-white/10"
                        }`}>
                           {msg.content}
                        </div>
                     </div>
                  </div>
                ))
              )}
              
              {chatMutation.isPending && (
                <div className="flex gap-4 max-w-2xl">
                   <Avatar className="h-10 w-10 border border-primary/50">
                      <AvatarFallback className="bg-primary text-black font-bold">AI</AvatarFallback>
                   </Avatar>
                   <div className="space-y-2 flex-1">
                      <div className="text-sm font-medium text-muted-foreground">{agent.name}</div>
                      <div className="p-4 rounded-2xl rounded-tl-none bg-white/5 border border-white/10 flex items-center gap-2">
                         <Loader2 className="w-4 h-4 animate-spin text-primary" />
                         <span className="text-muted-foreground">Thinking...</span>
                      </div>
                   </div>
                </div>
              )}
           </div>

           <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
              <div className="flex items-center gap-3">
                 <Button
                   size="icon"
                   className={`h-12 w-12 rounded-full transition-all ${
                     isRecording 
                       ? "bg-red-500 hover:bg-red-600 animate-pulse" 
                       : "bg-purple-500 hover:bg-purple-600"
                   }`}
                   onClick={handleVoiceToggle}
                   disabled={chatMutation.isPending}
                   data-testid="button-voice-input"
                 >
                   {isRecording ? (
                     <Square className="w-5 h-5 text-white" />
                   ) : (
                     <Mic className="w-5 h-5 text-white" />
                   )}
                 </Button>
                 
                 <div className="relative flex-1">
                   <input 
                     className={`w-full bg-background border rounded-xl p-4 pr-12 focus:ring-1 focus:ring-primary focus:border-primary transition-all text-base ${
                       isRecording ? "border-red-500/50 bg-red-500/5" : "border-white/10"
                     }`}
                     placeholder={isRecording ? "Speak now... (real-time transcription)" : "Ask the agent something..."}
                     value={chatInput}
                     onChange={(e) => setChatInput(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && !isRecording && handleSendChat()}
                     disabled={isRecording}
                     data-testid="input-chat"
                   />
                   <Button 
                     size="icon" 
                     className="absolute top-1/2 -translate-y-1/2 right-3 h-8 w-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                     onClick={handleSendChat}
                     disabled={chatMutation.isPending || !chatInput.trim() || isRecording}
                   >
                     <MessageCircle className="w-4 h-4" />
                   </Button>
                 </div>
              </div>
              
              {isRecording && (
                <div className="flex items-center gap-2 text-sm text-red-400">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  Listening... Speak now. Click stop when done to send your message.
                </div>
              )}

              {inputText && (
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Latest Response (for TTS)</span>
                    <div className="flex items-center gap-2">
                      {audioUrl ? (
                        <>
                          <Button 
                            size="sm" 
                            variant="secondary" 
                            className="rounded-full h-7 px-3 bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 text-xs"
                            onClick={handlePlayPause}
                            data-testid="button-play-audio"
                          >
                            {isPlaying ? <Pause className="w-3 h-3 mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                            {isPlaying ? "Pause" : "Play"}
                          </Button>
                          <span className="text-xs text-muted-foreground font-mono">
                            {formatTime(currentTime)} / {formatTime(audioDuration)}
                          </span>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="rounded-full h-7 px-3 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20 text-xs"
                          onClick={handleGenerateAudio}
                          disabled={generateTTSMutation.isPending || !inputText.trim()}
                          data-testid="button-generate-audio"
                        >
                          {generateTTSMutation.isPending ? (
                            <>
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <Volume2 className="w-3 h-3 mr-1" />
                              Generate Audio
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{inputText}</p>
                </div>
              )}
           </div>
        </div>

        <div className="lg:col-span-5 bg-background p-8 overflow-y-auto border-l border-white/5">
           <div className="mb-8">
              <h2 className="text-xl font-display font-semibold mb-2 flex items-center gap-2">
                <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" /> 
                Quality Evaluation
              </h2>
              <p className="text-sm text-muted-foreground">Rate the generated speech quality based on the attributes below.</p>
           </div>

           <div className="space-y-8">
              
              <div className="space-y-4">
                 <div className="flex justify-between items-center">
                    <Label className="text-base font-medium">Naturalness</Label>
                    <span className="text-sm font-mono text-primary">{ratings.naturalness}%</span>
                 </div>
                 <Slider 
                   value={[ratings.naturalness]} 
                   onValueChange={(v) => setRatings({...ratings, naturalness: v[0]})}
                   max={100} 
                   step={1}
                   className="py-2"
                   data-testid="slider-naturalness"
                 />
                 <p className="text-xs text-muted-foreground">Does the voice sound human-like and authentic?</p>
              </div>

              <Separator className="bg-white/5" />

              <div className="space-y-4">
                 <div className="flex justify-between items-center">
                    <Label className="text-base font-medium">Clarity & Pronunciation</Label>
                    <span className="text-sm font-mono text-primary">{ratings.clarity}%</span>
                 </div>
                 <Slider 
                   value={[ratings.clarity]} 
                   onValueChange={(v) => setRatings({...ratings, clarity: v[0]})}
                   max={100} 
                   step={1}
                   className="py-2"
                   data-testid="slider-clarity"
                 />
                 <p className="text-xs text-muted-foreground">Are words pronounced clearly and correctly?</p>
              </div>

              <Separator className="bg-white/5" />

              <div className="space-y-4">
                 <div className="flex justify-between items-center">
                    <Label className="text-base font-medium">Intonation & Emotion</Label>
                    <span className="text-sm font-mono text-primary">{ratings.intonation}%</span>
                 </div>
                 <Slider 
                   value={[ratings.intonation]} 
                   onValueChange={(v) => setRatings({...ratings, intonation: v[0]})}
                   max={100} 
                   step={1}
                   className="py-2"
                   data-testid="slider-intonation"
                 />
                 <p className="text-xs text-muted-foreground">Does the speech have appropriate emotional range?</p>
              </div>

              <Separator className="bg-white/5" />

              <div className="space-y-4">
                 <div className="flex justify-between items-center">
                    <Label className="text-base font-medium">Speed & Pacing</Label>
                    <span className="text-sm font-mono text-primary">{ratings.speed}%</span>
                 </div>
                 <Slider 
                   value={[ratings.speed]} 
                   onValueChange={(v) => setRatings({...ratings, speed: v[0]})}
                   max={100} 
                   step={1}
                   className="py-2"
                   data-testid="slider-speed"
                 />
                 <p className="text-xs text-muted-foreground">Is the speaking rate comfortable to listen to?</p>
              </div>

              {evaluations.length > 0 && (
                <>
                  <Separator className="bg-white/5" />
                  <div className="pt-2">
                    <h3 className="font-medium mb-3 text-sm">Previous Evaluations ({evaluations.length})</h3>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {evaluations.slice(-5).reverse().map((evaluation) => (
                        <div key={evaluation.id} className="p-3 rounded-lg bg-white/5 border border-white/10 text-xs">
                          <div className="flex justify-between mb-1">
                            <span className="text-muted-foreground">
                              {new Date(evaluation.createdAt).toLocaleDateString()}
                            </span>
                            <span className="text-primary font-mono">
                              Avg: {Math.round((evaluation.naturalness + evaluation.clarity + evaluation.intonation + evaluation.speed) / 4)}%
                            </span>
                          </div>
                          <p className="text-muted-foreground line-clamp-1">{evaluation.inputText}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="pt-6">
                 <Card className="bg-white/5 border-white/10 p-4">
                    <h3 className="font-medium mb-2 text-sm">AI Analysis</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                       The agent demonstrates high clarity but slightly monotonic intonation in this sample. 
                       Consider increasing the temperature parameter for more variability.
                    </p>
                 </Card>
              </div>

           </div>
        </div>

      </main>
    </div>
  );
}
