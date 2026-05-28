import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Mic, MicOff, Play, Pause, Send, Download, Settings2, Star, Loader2, Volume2, MessageCircle, Square, Video, VideoOff, User, Maximize2, Minimize2, Camera, ScanLine, X, RotateCcw, CheckCircle2, Wallet, TrendingUp, ArrowUpRight, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentsApi, evaluationsApi, ttsApi, chatApi, anamApi, ocrApi, type TTSRequest } from "@/lib/api";
import type { InsertEvaluation } from "@shared/schema";
import type { ChatMessage } from "@/lib/api";
import { VoiceAgentPanel } from "@/components/voice-agent-panel";
import { VoiceMonitorPage } from "@/components/voice-monitor-page";
import {
  createRetailAssistState,
  getRetailAssistEventTypeForTool,
  updateRetailAssistState,
} from "@/components/retail-agent-assist";

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
  const [inputText, setInputText] = useState("Welcome to Webex Voice Agent Studio. I am ready to assist you.");
  
  const [ratings, setRatings] = useState({
    naturalness: 75,
    clarity: 85,
    intonation: 60,
    speed: 50
  });

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [retailAssistState, setRetailAssistState] = useState(createRetailAssistState);
  
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [autoPlayVoice, setAutoPlayVoice] = useState(true);
  const deepgramSocketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const responseAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const transcriptRef = useRef<string>("");

  const [avatarEnabled, setAvatarEnabled] = useState(false);
  const [avatarStreaming, setAvatarStreaming] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarFullscreen, setAvatarFullscreen] = useState(false);
  const avatarVideoRef = useRef<HTMLVideoElement | null>(null);
  const avatarContainerRef = useRef<HTMLDivElement | null>(null);
  const anamClientRef = useRef<any>(null);
  const avatarStreamingRef = useRef(false);

  useEffect(() => {
    const onFsChange = () => setAvatarFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleAvatarFullscreen = useCallback(() => {
    if (!avatarContainerRef.current) return;
    if (!document.fullscreenElement) {
      avatarContainerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const handleRetailRealtimeEvent = useCallback((event: any) => {
    setRetailAssistState((current) => updateRetailAssistState(current, event));
  }, []);

  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrStream, setOcrStream] = useState<MediaStream | null>(null);
  const [ocrCapture, setOcrCapture] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const ocrVideoRef = useRef<HTMLVideoElement | null>(null);
  const ocrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ocrAutoModeRef = useRef(false);

  // Banking auth state machine for avatar-native flow
  const bankingAvatarStateRef = useRef<"idle" | "awaiting_identity" | "otp_sent" | "authenticated">("idle");
  const bankingOtpTokenRef = useRef<string | null>(null);
  const bankingAvatarProcessingRef = useRef(false);
  const lastSeenHumanMsgIdRef = useRef<string | null>(null);

  const [bankBalance, setBankBalance] = useState(2450.00);
  const [lastDeposit, setLastDeposit] = useState<{ amount: number; newBalance: number } | null>(null);

  const openOcrCamera = useCallback(async () => {
    setOcrOpen(true);
    setOcrCapture(null);
    setOcrText(null);
    setOcrError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      setOcrStream(stream);
      setTimeout(() => {
        if (ocrVideoRef.current) {
          ocrVideoRef.current.srcObject = stream;
          ocrVideoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch {
      setOcrError("Could not access camera. Please allow camera permission and try again.");
    }
  }, []);

  const closeOcrCamera = useCallback(() => {
    if (ocrStream) {
      ocrStream.getTracks().forEach(t => t.stop());
      setOcrStream(null);
    }
    setOcrOpen(false);
    setOcrCapture(null);
    setOcrText(null);
    setOcrError(null);
    ocrAutoModeRef.current = false;
  }, [ocrStream]);

  const extractDollarAmount = (text: string): string | null => {
    const match = text.match(/\$\s*([\d,]+\.?\d{0,2})/);
    return match ? `$${match[1]}` : null;
  };


  const retakeOcr = useCallback(async () => {
    setOcrCapture(null);
    setOcrText(null);
    setOcrError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      setOcrStream(stream);
      setTimeout(() => {
        if (ocrVideoRef.current) {
          ocrVideoRef.current.srcObject = stream;
          ocrVideoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch {
      setOcrError("Could not access camera.");
    }
  }, []);

  const sendOcrToChat = useCallback(() => {
    if (!ocrText) return;
    setChatInput(prev => prev ? `${prev}\n\n[Scanned text]\n${ocrText}` : `[Scanned text]\n${ocrText}`);
    closeOcrCamera();
  }, [ocrText, closeOcrCamera]);

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

  const { data: anamStatus } = useQuery({
    queryKey: ["anam-status"],
    queryFn: () => anamApi.getStatus(),
  });

  useEffect(() => {
    if (agent?.id) {
      setRetailAssistState(createRetailAssistState());
    }
  }, [agent?.id]);

  const startAvatar = useCallback(async () => {
    if (!agent) return;
    setAvatarLoading(true);
    setAvatarError(null);
    try {
      const { sessionToken } = await anamApi.getSessionToken({
        name: agent.name,
        systemPrompt: agent.systemPrompt || `You are ${agent.name}, a helpful AI assistant. Reply in natural speech without formatting. Add pauses using '...'`,
      }, agent.id);

      const { createClient, AnamEvent } = await import("@anam-ai/js-sdk");
      const client = createClient(sessionToken);
      anamClientRef.current = client;

      const CHECK_TRIGGERS = [
        "show me your check", "show your check", "show the check",
        "show me the check", "hold up your check", "hold up the check",
        "your check to the camera", "check to the camera",
        "scan your check", "photograph your check",
        "show it to the camera", "hold the check",
        "present your check", "place the check",
      ];

      const DEPOSIT_PATTERNS = [
        /deposited\s+\$?([\d,]+\.?\d{0,2})/i,
        /deposit\s+of\s+\$?([\d,]+\.?\d{0,2})/i,
        /\$?([\d,]+\.?\d{0,2})\s+(?:has been|have been)\s+deposited/i,
        /successfully\s+(?:deposited|processed)[^$]*\$?([\d,]+\.?\d{0,2})/i,
        /processed\s+(?:your\s+)?deposit\s+of\s+\$?([\d,]+\.?\d{0,2})/i,
        /added\s+\$?([\d,]+\.?\d{0,2})\s+to\s+your\s+(?:account|balance)/i,
      ];

      const lastSeenPersonaMsgId = { current: null as string | null };

      // ── Banking identity triggers from avatar ──────────────────────────────
      const IDENTITY_ASK_TRIGGERS = [
        "last 4 digits", "last four digits", "last four of", "last 4 of",
        "verify your identity", "full name and", "your full name",
        "name and the last", "name and last"
      ];
      const CODE_ASK_TRIGGERS = [
        "6-digit code", "six-digit", "verification code", "code you received",
        "code sent", "say the code", "read me the code"
      ];

      client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (messages: any[]) => {
        // ── Handle new persona (avatar) messages ────────────────────────────
        const personaMsgs = messages.filter((m: any) => m.role === "persona" && !m.interrupted);
        const latestPersona = personaMsgs[personaMsgs.length - 1];
        if (latestPersona && latestPersona.id !== lastSeenPersonaMsgId.current) {
          lastSeenPersonaMsgId.current = latestPersona.id;
          const content: string = latestPersona.content;
          const lower = content.toLowerCase();

          setChatMessages(prev => {
            const updated = [...prev, { role: "assistant" as const, content }];
            chatMessagesRef.current = updated;
            return updated;
          });

          if (CHECK_TRIGGERS.some(t => lower.includes(t))) {
            ocrAutoModeRef.current = true;
            openOcrCamera();
          }

          for (const pattern of DEPOSIT_PATTERNS) {
            const match = content.match(pattern);
            if (match) {
              const amount = parseFloat(match[1].replace(/,/g, ""));
              if (!isNaN(amount) && amount > 0) {
                setBankBalance(prev => {
                  const newBalance = Math.round((prev + amount) * 100) / 100;
                  setLastDeposit({ amount, newBalance });
                  return newBalance;
                });
                break;
              }
            }
          }

          // Advance banking state machine based on what avatar asked
          if (bankingAvatarStateRef.current === "idle" &&
              IDENTITY_ASK_TRIGGERS.some(t => lower.includes(t))) {
            bankingAvatarStateRef.current = "awaiting_identity";
            console.log("[Banking Avatar] State → awaiting_identity");
          }
          if (bankingAvatarStateRef.current === "otp_sent" &&
              CODE_ASK_TRIGGERS.some(t => lower.includes(t))) {
            console.log("[Banking Avatar] Confirmed awaiting code");
          }
        }

        // ── Handle new human (user) messages ───────────────────────────────
        const humanMsgs = messages.filter((m: any) => m.role === "human" || m.role === "user");
        const latestHuman = humanMsgs[humanMsgs.length - 1];
        if (!latestHuman || latestHuman.id === lastSeenHumanMsgIdRef.current) return;
        lastSeenHumanMsgIdRef.current = latestHuman.id;

        const humanContent: string = latestHuman.content || "";
        console.log("[Banking Avatar] User said:", humanContent, "| State:", bankingAvatarStateRef.current);

        // Add user message to chat panel
        setChatMessages(prev => {
          if (prev.some(m => m.role === "user" && m.content === humanContent)) return prev;
          const updated = [...prev, { role: "user" as const, content: humanContent }];
          chatMessagesRef.current = updated;
          return updated;
        });

        // State: waiting for name + last4
        if (bankingAvatarStateRef.current === "awaiting_identity" && !bankingAvatarProcessingRef.current) {
          bankingAvatarProcessingRef.current = true;
          console.log("[Banking Avatar] Extracting identity from:", humanContent);
          fetch("/api/banking/extract-and-send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: humanContent, agentId: agent?.id })
          })
            .then(r => r.json())
            .then(data => {
              console.log("[Banking Avatar] extract-and-send result:", data);
              bankingAvatarProcessingRef.current = false;
              if (data.token) {
                bankingOtpTokenRef.current = data.token;
                bankingAvatarStateRef.current = "otp_sent";
              } else {
                bankingAvatarStateRef.current = "idle";
              }
              // Override avatar speech with our tool-aware response
              setTimeout(() => {
                client.talk(data.response);
              }, 600);
            })
            .catch(err => {
              console.error("[Banking Avatar] extract-and-send error:", err);
              bankingAvatarProcessingRef.current = false;
            });
        }

        // State: waiting for 6-digit OTP code
        else if (bankingAvatarStateRef.current === "otp_sent" && !bankingAvatarProcessingRef.current) {
          bankingAvatarProcessingRef.current = true;
          console.log("[Banking Avatar] Extracting code from:", humanContent);
          fetch("/api/banking/extract-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: humanContent })
          })
            .then(r => r.json())
            .then(data => {
              bankingAvatarProcessingRef.current = false;
              if (!data.code) {
                console.log("[Banking Avatar] No 6-digit code found yet");
                return;
              }
              console.log("[Banking Avatar] Verifying code:", data.code);
              return fetch("/api/auth/verify-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: bankingOtpTokenRef.current, code: data.code })
              })
                .then(r => r.json())
                .then(verifyData => {
                  if (verifyData.verified) {
                    bankingAvatarStateRef.current = "authenticated";
                    setIsAuthenticated(true);
                    setTimeout(() => {
                      client.talk("Thank you, your identity has been verified. I've blocked your card immediately. A replacement will be shipped to your address on file and should arrive within 3 to 5 business days. Is there anything else I can help you with?");
                    }, 600);
                  } else {
                    setTimeout(() => {
                      client.talk("I'm sorry, that code doesn't match. Please check the SMS and try again, or I can send you a new code.");
                    }, 600);
                  }
                });
            })
            .catch(err => {
              console.error("[Banking Avatar] code verify error:", err);
              bankingAvatarProcessingRef.current = false;
            });
        }
      });

      if (avatarVideoRef.current) {
        await client.streamToVideoElement(avatarVideoRef.current.id);
        avatarStreamingRef.current = true;
        setAvatarStreaming(true);
        setAvatarEnabled(true);
      } else {
        throw new Error("Video element not ready. Please try again.");
      }
    } catch (error: any) {
      console.error("Avatar start error:", error);
      setAvatarError(error.message || "Failed to start avatar");
    } finally {
      setAvatarLoading(false);
    }
  }, [agent]);

  const stopAvatar = useCallback(async () => {
    try {
      if (anamClientRef.current) {
        await anamClientRef.current.stopStreaming();
        anamClientRef.current = null;
      }
    } catch (error) {
      console.error("Avatar stop error:", error);
    }
    avatarStreamingRef.current = false;
    setAvatarStreaming(false);
    setAvatarEnabled(false);
    // Reset banking state machine
    bankingAvatarStateRef.current = "idle";
    bankingOtpTokenRef.current = null;
    bankingAvatarProcessingRef.current = false;
    lastSeenHumanMsgIdRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (anamClientRef.current) {
        try {
          anamClientRef.current.stopStreaming();
        } catch {}
        anamClientRef.current = null;
      }
    };
  }, []);


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
    if (!voice) return;

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

  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const chatMutation = useMutation({
    mutationFn: ({ message, history }: { message: string; history: ChatMessage[] }) => chatApi.send({
      message,
      systemPrompt: agent?.systemPrompt,
      agentId: agent?.id,
      history,
    }),
    onSuccess: (response) => {
      if (response.verified === true) setIsAuthenticated(true);
      const completedTools = response.toolResults?.length
        ? response.toolResults
        : response.toolUsed
          ? [{ toolName: response.toolUsed, result: response.toolResult || {} }]
          : [];
      if (completedTools.length > 0) {
        setRetailAssistState((current) => {
          let next = current;
          for (const completedTool of completedTools) {
            const completedEvent = {
              type: "toolCallCompleted",
              toolName: completedTool.toolName,
              success: completedTool.result?.success ?? true,
              result: completedTool.result?.result,
              error: completedTool.result?.error,
              data: completedTool.result?.data,
              timestamp: Date.now(),
            };
            next = updateRetailAssistState(next, completedEvent);
            const assistEventType = getRetailAssistEventTypeForTool(completedTool.toolName);
            if (assistEventType && completedTool.result?.data !== undefined) {
              next = updateRetailAssistState(next, {
                type: assistEventType,
                data: completedTool.result.data,
                timestamp: Date.now(),
              });
            }
          }
          return next;
        });
      }
      const assistantMsg = response.response;
      setChatMessages(prev => {
        const updated = [...prev, { role: "assistant" as const, content: assistantMsg }];
        chatMessagesRef.current = updated;
        return updated;
      });
      setInputText(assistantMsg);
      setAudioUrl(null);

      // If avatar is active, speak the response through it; otherwise use TTS
      if (avatarStreamingRef.current && anamClientRef.current) {
        try {
          anamClientRef.current.talk(assistantMsg);
        } catch (e) {
          console.error("Avatar talk error:", e);
          if (autoPlayVoice) generateAndPlayAudio(assistantMsg);
        }
      } else if (autoPlayVoice) {
        generateAndPlayAudio(assistantMsg);
      }

      const lower = assistantMsg.toLowerCase();

      const checkTriggers = [
        "show me your check", "show your check", "show the check",
        "show me the check", "hold up your check", "hold up the check",
        "your check to the camera", "check to the camera",
        "scan your check", "photograph your check",
        "show it to the camera", "hold the check",
        "present your check", "place the check",
      ];
      if (checkTriggers.some(t => lower.includes(t))) {
        ocrAutoModeRef.current = true;
        openOcrCamera();
      }

      const depositPatterns = [
        /deposited\s+\$?([\d,]+\.?\d{0,2})/i,
        /deposit\s+of\s+\$?([\d,]+\.?\d{0,2})/i,
        /\$?([\d,]+\.?\d{0,2})\s+(?:has been|have been)\s+deposited/i,
        /successfully\s+(?:deposited|processed)[^$]*\$?([\d,]+\.?\d{0,2})/i,
        /processed\s+(?:your\s+)?deposit\s+of\s+\$?([\d,]+\.?\d{0,2})/i,
        /added\s+\$?([\d,]+\.?\d{0,2})\s+to\s+your\s+(?:account|balance)/i,
      ];
      for (const pattern of depositPatterns) {
        const match = assistantMsg.match(pattern);
        if (match) {
          const amount = parseFloat(match[1].replace(/,/g, ""));
          if (!isNaN(amount) && amount > 0) {
            setBankBalance(prev => {
              const newBalance = Math.round((prev + amount) * 100) / 100;
              setLastDeposit({ amount, newBalance });
              return newBalance;
            });
            break;
          }
        }
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

  const sendOcrToAgent = useCallback((extractedText: string) => {
    const amount = extractDollarAmount(extractedText);
    const message = amount
      ? `I'm holding up my check to the camera. The amount I can see is ${amount}. Full check details:\n${extractedText}`
      : `I'm holding up my check to the camera. Here's what it says:\n${extractedText}`;
    const newUserMessage: ChatMessage = { role: "user", content: message };

    if (avatarStreamingRef.current && anamClientRef.current) {
      setChatMessages(prev => {
        const updated = [...prev, newUserMessage];
        chatMessagesRef.current = updated;
        return updated;
      });
      try {
        anamClientRef.current.sendUserMessage(message);
      } catch (e) {
        console.error("Failed to send OCR message to avatar:", e);
      }
    } else {
      const currentHistory = chatMessagesRef.current;
      chatMessagesRef.current = [...currentHistory, newUserMessage];
      setChatMessages(chatMessagesRef.current);
      chatMutation.mutate({ message, history: currentHistory });
    }
  }, [chatMutation]);

  const captureOcrFrame = useCallback(() => {
    const video = ocrVideoRef.current;
    const canvas = ocrCanvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setOcrCapture(dataUrl);
    if (ocrStream) {
      ocrStream.getTracks().forEach(t => t.stop());
      setOcrStream(null);
    }
    setOcrLoading(true);
    setOcrText(null);
    setOcrError(null);
    const isAutoMode = ocrAutoModeRef.current;
    ocrApi.extractText(dataUrl)
      .then(({ text }) => {
        setOcrText(text);
        if (isAutoMode) {
          sendOcrToAgent(text);
          setTimeout(() => closeOcrCamera(), 800);
        }
      })
      .catch(e => setOcrError(e.message || "Failed to extract text"))
      .finally(() => setOcrLoading(false));
  }, [ocrStream, sendOcrToAgent, closeOcrCamera]);

  const floatTo16BitPCM = useCallback((float32Array: Float32Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  }, []);

  const startVoiceRecording = useCallback(async () => {
    try {
      if (responseAudioRef.current) {
        responseAudioRef.current.pause();
        responseAudioRef.current = null;
      }

      setIsConnecting(true);
      transcriptRef.current = "";
      setChatInput("");

      const keyResponse = await fetch('/api/deepgram/key');
      if (!keyResponse.ok) {
        throw new Error('Failed to get Deepgram API key');
      }
      const { key } = await keyResponse.json();

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const socket = new WebSocket(
        `wss://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true&interim_results=true&encoding=linear16&sample_rate=16000`,
        ['token', key]
      );

      socket.onopen = () => {
        console.log('Deepgram WebSocket connected');
        setIsConnecting(false);
        setIsRecording(true);

        processor.onaudioprocess = (e) => {
          if (socket.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = floatTo16BitPCM(inputData);
            socket.send(pcmData);
          }
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Deepgram message:', data);
          if (data.channel?.alternatives?.[0]?.transcript) {
            const transcript = data.channel.alternatives[0].transcript;
            const isFinal = data.is_final;
            
            if (isFinal && transcript) {
              transcriptRef.current += transcript + ' ';
              setChatInput(transcriptRef.current);
            } else if (transcript) {
              setChatInput(transcriptRef.current + transcript);
            }
          }
        } catch (e) {
          console.error('Error parsing Deepgram response:', e);
        }
      };

      socket.onerror = (error) => {
        console.error('Deepgram WebSocket error:', error);
        toast({
          title: "Connection Error",
          description: "Failed to connect to speech recognition service.",
          variant: "destructive",
        });
        setIsRecording(false);
        setIsConnecting(false);
        stream.getTracks().forEach(track => track.stop());
        if (audioContext.state !== 'closed') {
          audioContext.close();
        }
      };

      socket.onclose = (event) => {
        console.log('Deepgram WebSocket closed', event.code, event.reason);
        setIsRecording(false);
        setIsConnecting(false);
        
        if (processorRef.current) {
          processorRef.current.disconnect();
          processorRef.current = null;
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }

        const finalText = transcriptRef.current.trim();
        if (finalText) {
          const currentHistory = chatMessagesRef.current;
          const newMessage: ChatMessage = { role: "user", content: finalText };
          setChatMessages(prev => [...prev, newMessage]);
          chatMutation.mutate({ message: finalText, history: currentHistory });
          setChatInput("");
        }
      };

      deepgramSocketRef.current = socket;

    } catch (error: any) {
      setIsConnecting(false);
      setIsRecording(false);
      console.error('Voice recording error:', error);
      toast({
        title: "Microphone Access Denied",
        description: error.message || "Please allow microphone access to use voice input.",
        variant: "destructive",
      });
    }
  }, [toast, chatMutation, floatTo16BitPCM]);

  const stopVoiceRecording = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
    }
    if (deepgramSocketRef.current && deepgramSocketRef.current.readyState === WebSocket.OPEN) {
      deepgramSocketRef.current.close();
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
    if (!voice) {
      toast({
        title: "No Voice Configured",
        description: "Please select a voice model for this agent.",
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
  const isStoreAssistant =
    agent.name.toLowerCase().includes("store") ||
    agent.systemPrompt.toLowerCase().includes("retail store assistant");
  const showEvaluationControls = !isStoreAssistant;

  if (isStoreAssistant) {
    return (
      <VoiceMonitorPage
        title={agent.name}
        subtitle={getAgentMonitorSubtitle(agent)}
        onBack={() => setLocation("/")}
      >
        <VoiceAgentPanel
          agentId={agent.id}
          agentName={agent.name}
          systemPrompt={agent.systemPrompt || undefined}
          voice={agent.voiceModel}
          gender={agent.gender}
          onRealtimeEvent={handleRetailRealtimeEvent}
          onSessionStart={() => setRetailAssistState(createRetailAssistState())}
          assistState={retailAssistState}
          layout="split"
        />
      </VoiceMonitorPage>
    );
  }

  return (
    <div className="h-screen bg-background text-foreground font-sans flex flex-col overflow-hidden">
      <audio 
        ref={audioRef}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setAudioDuration(e.currentTarget.duration)}
        onEnded={() => setIsPlaying(false)}
      />
      
      <header className="shrink-0 border-b border-white/10 bg-background/50 backdrop-blur-md h-16 flex items-center px-6 justify-between sticky top-0 z-50">
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
           {isAuthenticated && (
             <Badge className="bg-green-500/10 text-green-400 border-green-500/20 gap-1.5" data-testid="badge-authenticated">
               <CheckCircle2 className="w-3 h-3" /> Authenticated
             </Badge>
           )}
           {showEvaluationControls && avgScore !== null && (
             <Badge className="bg-primary/10 text-primary border-primary/20">
               Avg Score: {avgScore}%
             </Badge>
           )}
           <Button variant="outline" size="sm" className="border-white/10 bg-white/5 hover:bg-white/10">
             <Settings2 className="w-4 h-4 mr-2" /> Settings
           </Button>
           {showEvaluationControls && (
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
           )}
        </div>
      </header>

      <main className="flex-1 min-h-0 grid lg:grid-cols-12 gap-0 overflow-hidden">
        {isStoreAssistant ? (
          <div className="lg:col-span-12 min-h-0 bg-card/20 p-4">
            <div className="flex h-full min-h-0 overflow-hidden rounded-lg border border-white/10 bg-background/50">
              <VoiceAgentPanel
                agentId={agent.id}
                agentName={agent.name}
                systemPrompt={agent.systemPrompt || undefined}
                voice={agent.voiceModel}
                gender={agent.gender}
                onRealtimeEvent={handleRetailRealtimeEvent}
                onSessionStart={() => setRetailAssistState(createRetailAssistState())}
                assistState={retailAssistState}
                layout="split"
              />
            </div>
          </div>
        ) : (
          <>
        <div className="lg:col-span-7 flex flex-col min-h-0 border-r border-white/10 bg-card/20 p-6 overflow-y-auto">
           {anamStatus?.configured && (
             <div className="mb-4">
               <div
                 ref={avatarContainerRef}
                 className="relative rounded-2xl overflow-hidden border border-white/10 bg-black/40 [&:fullscreen]:rounded-none [&:fullscreen]:border-none"
               >
                 <video
                   id="anam-video-element"
                   ref={avatarVideoRef}
                   autoPlay
                   playsInline
                   className={`w-full transition-all [&:fullscreen]:h-screen [&:fullscreen]:object-contain ${avatarStreaming ? 'block' : 'hidden'}`}
                   style={{ maxHeight: avatarFullscreen ? '100vh' : 400, objectFit: 'cover' }}
                   data-testid="video-avatar"
                 />
                 {!avatarStreaming && !avatarLoading && (
                   <div className="flex flex-col items-center justify-center py-8 gap-3">
                     <div className="h-16 w-16 rounded-full bg-gradient-to-br from-primary/20 to-cyan-400/20 border border-white/10 flex items-center justify-center">
                       <User className="w-8 h-8 text-primary/60" />
                     </div>
                     <p className="text-sm text-muted-foreground">Interactive AI Avatar</p>
                     <Button
                       size="sm"
                       className="bg-gradient-to-r from-primary to-cyan-400 text-black font-medium hover:opacity-90"
                       onClick={startAvatar}
                       data-testid="button-start-avatar"
                     >
                       <Video className="w-4 h-4 mr-2" />
                       Start Avatar
                     </Button>
                   </div>
                 )}

                 {avatarLoading && (
                   <div className="flex flex-col items-center justify-center py-8 gap-3">
                     <Loader2 className="w-8 h-8 animate-spin text-primary" />
                     <p className="text-sm text-muted-foreground">Connecting to avatar...</p>
                   </div>
                 )}

                 {avatarStreaming && (
                   <div className="absolute top-3 right-3 flex items-center gap-2">
                     <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                       <span className="w-1.5 h-1.5 bg-green-400 rounded-full mr-1.5 animate-pulse inline-block" />
                       Live
                     </Badge>
                     <Button
                       size="icon"
                       variant="ghost"
                       className="h-7 w-7 bg-black/50 hover:bg-black/70 text-white rounded-full"
                       onClick={toggleAvatarFullscreen}
                       data-testid="button-avatar-fullscreen"
                       title={avatarFullscreen ? "Exit fullscreen" : "Fullscreen"}
                     >
                       {avatarFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                     </Button>
                     <Button
                       size="icon"
                       variant="ghost"
                       className="h-7 w-7 bg-black/50 hover:bg-black/70 text-white rounded-full"
                       onClick={stopAvatar}
                       data-testid="button-stop-avatar"
                     >
                       <VideoOff className="w-3.5 h-3.5" />
                     </Button>
                   </div>
                 )}

                 {avatarError && (
                   <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/20">
                     <p className="text-xs text-red-400">{avatarError}</p>
                   </div>
                 )}
               </div>
             </div>
           )}

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
                   variant="outline"
                   className="h-12 w-12 rounded-full border-white/10 bg-white/5 hover:bg-white/10 hover:border-cyan-500/40 text-muted-foreground hover:text-cyan-400 shrink-0"
                   onClick={openOcrCamera}
                   title="Scan text with camera"
                   data-testid="button-ocr-scan"
                 >
                   <ScanLine className="w-5 h-5" />
                 </Button>
                 <Button
                   size="icon"
                   className={`h-12 w-12 rounded-full transition-all shrink-0 ${
                     isRecording 
                       ? "bg-red-500 hover:bg-red-600 animate-pulse" 
                       : isConnecting
                         ? "bg-yellow-500 hover:bg-yellow-600"
                         : "bg-purple-500 hover:bg-purple-600"
                   }`}
                   onClick={handleVoiceToggle}
                   disabled={chatMutation.isPending || isConnecting}
                   data-testid="button-voice-input"
                 >
                   {isRecording ? (
                     <Square className="w-5 h-5 text-white" />
                   ) : isConnecting ? (
                     <Loader2 className="w-5 h-5 text-white animate-spin" />
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
              
              {isConnecting && (
                <div className="flex items-center gap-2 text-sm text-yellow-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Connecting to Deepgram...
                </div>
              )}
              
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

        <div className="lg:col-span-5 min-h-0 bg-background border-l border-white/5 flex flex-col overflow-hidden">
          <Tabs defaultValue="voice" className="flex flex-col h-full">
            <TabsList className="w-full justify-start rounded-none border-b border-white/10 bg-transparent px-4 pt-2 h-auto">
              <TabsTrigger value="voice" className="gap-2 data-[state=active]:bg-white/5 rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary">
                <Phone className="w-4 h-4" /> Voice
              </TabsTrigger>
              <TabsTrigger value="eval" className="gap-2 data-[state=active]:bg-white/5 rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary">
                <Star className="w-4 h-4" /> Evaluate
              </TabsTrigger>
            </TabsList>

            <TabsContent value="voice" className="flex-1 overflow-hidden m-0">
              <VoiceAgentPanel
                agentId={agent.id}
                agentName={agent.name}
                systemPrompt={agent.systemPrompt || undefined}
                voice={agent.voiceModel}
                gender={agent.gender}
              />
            </TabsContent>

            <TabsContent value="eval" className="flex-1 overflow-y-auto m-0 p-8">
              <div className="mb-8">
                <div
                  className="rounded-2xl overflow-hidden border border-white/10 relative"
                  style={{ background: "linear-gradient(135deg, #0f2027 0%, #1a3a4a 50%, #0d2137 100%)" }}
                  data-testid="card-bank-account"
                >
                  <div className="absolute inset-0 opacity-10"
                    style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 30px, rgba(255,255,255,0.03) 30px, rgba(255,255,255,0.03) 60px)" }}
                  />
                  <div className="relative p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
                          <Wallet className="w-4 h-4 text-cyan-400" />
                        </div>
                        <div>
                          <p className="text-xs text-cyan-300/70 font-medium tracking-wide uppercase">Checking Account</p>
                          <p className="text-xs text-white/40">•••• •••• •••• 4291</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-white/40 mb-1">Available Balance</p>
                        <p
                          className="text-2xl font-mono font-bold text-white tracking-tight"
                          data-testid="text-bank-balance"
                        >
                          ${bankBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>

                    {lastDeposit && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center justify-between bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 mt-2"
                        data-testid="card-last-deposit"
                      >
                        <div className="flex items-center gap-2 text-green-400 text-xs">
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          <span className="font-medium">Deposit processed</span>
                        </div>
                        <span className="text-green-300 text-xs font-mono font-semibold">
                          +${lastDeposit.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </span>
                      </motion.div>
                    )}

                    {!lastDeposit && (
                      <div className="flex items-center gap-2 text-white/30 text-xs mt-2">
                        <TrendingUp className="w-3.5 h-3.5" />
                        <span>No recent transactions</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

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
            </TabsContent>
          </Tabs>
        </div>
          </>
        )}
      </main>

      <canvas ref={ocrCanvasRef} className="hidden" />

      {ocrOpen && createPortal(
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col" data-testid="ocr-modal">
          {ocrAutoModeRef.current && (
            <div className="bg-cyan-500/10 border-b border-cyan-500/20 px-6 py-2 flex items-center gap-2 text-cyan-300 text-xs">
              <Wallet className="w-3.5 h-3.5" />
              <span>Your banking agent is requesting the check — capture it below to continue the deposit.</span>
            </div>
          )}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                <ScanLine className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <h2 className="font-semibold text-sm">Scan Check</h2>
                <p className="text-xs text-muted-foreground">
                  {!ocrCapture ? "Point camera at the check and capture" : ocrLoading ? "Reading check with AI..." : ocrAutoModeRef.current ? "Sending to agent..." : "Text extracted"}
                </p>
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={closeOcrCamera}
              className="text-muted-foreground hover:text-white"
              data-testid="button-ocr-close"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          <div className="flex-1 flex flex-col lg:flex-row gap-0 overflow-hidden">
            <div className="flex-1 flex flex-col items-center justify-center p-6 bg-black">
              {!ocrCapture ? (
                <>
                  <div className="relative w-full max-w-2xl">
                    <video
                      ref={ocrVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full rounded-xl border border-white/10 bg-black"
                      style={{ maxHeight: "60vh", objectFit: "cover" }}
                      data-testid="video-ocr-camera"
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="border-2 border-cyan-400/60 rounded-lg w-4/5 h-2/3 relative">
                        <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-cyan-400 rounded-tl" />
                        <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-cyan-400 rounded-tr" />
                        <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-cyan-400 rounded-bl" />
                        <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-cyan-400 rounded-br" />
                      </div>
                    </div>
                  </div>
                  {ocrError && (
                    <p className="text-sm text-red-400 mt-4 text-center">{ocrError}</p>
                  )}
                  {!ocrError && (
                    <Button
                      className="mt-6 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold px-8 h-12 rounded-full"
                      onClick={captureOcrFrame}
                      disabled={!ocrStream}
                      data-testid="button-ocr-capture"
                    >
                      <Camera className="w-5 h-5 mr-2" />
                      Capture
                    </Button>
                  )}
                </>
              ) : (
                <div className="w-full max-w-2xl">
                  <img
                    src={ocrCapture}
                    alt="Captured"
                    className="w-full rounded-xl border border-white/10 object-contain"
                    style={{ maxHeight: "55vh" }}
                    data-testid="img-ocr-capture"
                  />
                  <div className="flex justify-center mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={retakeOcr}
                      className="gap-2 border-white/10"
                      data-testid="button-ocr-retake"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Retake
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="lg:w-96 border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col bg-background/50 p-6">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <CheckCircle2 className={`w-4 h-4 ${ocrText ? "text-green-400" : "text-muted-foreground/40"}`} />
                Extracted Text
              </h3>

              {ocrLoading && (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                  <p className="text-sm">Reading text with AI...</p>
                </div>
              )}

              {!ocrLoading && ocrError && (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-sm text-red-400 text-center">{ocrError}</p>
                </div>
              )}

              {!ocrLoading && ocrText && (
                <>
                  <div
                    className="flex-1 text-sm bg-white/5 rounded-xl border border-white/10 p-4 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed text-foreground/90"
                    data-testid="text-ocr-result"
                  >
                    {ocrText}
                  </div>
                  <div className="pt-4 flex gap-2">
                    <Button
                      className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold"
                      onClick={sendOcrToChat}
                      data-testid="button-ocr-send"
                    >
                      <MessageCircle className="w-4 h-4 mr-2" />
                      Send to Agent
                    </Button>
                  </div>
                </>
              )}

              {!ocrLoading && !ocrText && !ocrError && (
                <div className="flex-1 flex items-center justify-center text-muted-foreground/40 text-sm text-center">
                  Capture an image to extract text
                </div>
              )}
            </div>
          </div>
        </div>,
        avatarFullscreen && avatarContainerRef.current
          ? avatarContainerRef.current
          : document.body
      )}
    </div>
  );
}

function getAgentMonitorSubtitle(agent: {
  llmModel?: string | null;
  voiceModel?: string | null;
  language?: string | null;
}): string {
  return [
    agent.llmModel || "gpt-4o",
    agent.voiceModel || "voice",
    agent.language || "en-US",
  ].join(" • ");
}
