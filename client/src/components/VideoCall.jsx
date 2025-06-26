import { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  Phone, 
  Monitor, 
  MessageSquare,
  Users,
  Settings,
  Copy,
  Check
} from 'lucide-react';
import Chat from './Chat';
import ParticipantsList from './ParticipantsList';

const VideoCall = ({ socket, roomId, username, onLeaveRoom }) => {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [participants, setParticipants] = useState([]);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [messages, setMessages] = useState([]);
  const [roomIdCopied, setRoomIdCopied] = useState(false);

  const localVideoRef = useRef(null);
  const peerConnections = useRef(new Map());
  const remoteVideoRefs = useRef(new Map());

  // ICE servers configuration
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]
  };

  useEffect(() => {
    initializeMedia();
    setupSocketListeners();

    return () => {
      cleanup();
    };
  }, []);

  const initializeMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing media devices:', error);
    }
  };

  const setupSocketListeners = () => {
    socket.on('room-joined', (data) => {
      console.log('Room joined:', data);
      setParticipants(data.participants || []);
    });

    socket.on('user-joined', (data) => {
      console.log('User joined:', data);
      setParticipants(prev => [...prev, data.user]);
      createPeerConnection(data.user.id, false);
    });

    socket.on('user-left', (data) => {
      console.log('User left:', data);
      setParticipants(prev => prev.filter(p => p.id !== data.userId));
      
      // Clean up peer connection
      if (peerConnections.current.has(data.userId)) {
        peerConnections.current.get(data.userId).close();
        peerConnections.current.delete(data.userId);
      }
      
      // Remove remote stream
      setRemoteStreams(prev => {
        const newStreams = new Map(prev);
        newStreams.delete(data.userId);
        return newStreams;
      });
    });

    socket.on('offer', async (data) => {
      await handleOffer(data);
    });

    socket.on('answer', async (data) => {
      await handleAnswer(data);
    });

    socket.on('ice-candidate', async (data) => {
      await handleIceCandidate(data);
    });

    socket.on('chat-message', (data) => {
      setMessages(prev => [...prev, data]);
    });

    socket.on('user-video-toggled', (data) => {
      console.log('User video toggled:', data);
    });

    socket.on('user-audio-toggled', (data) => {
      console.log('User audio toggled:', data);
    });
  };

  const createPeerConnection = async (userId, isInitiator) => {
    const peerConnection = new RTCPeerConnection(iceServers);
    peerConnections.current.set(userId, peerConnection);

    // Add local stream to peer connection
    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }

    // Handle remote stream
    peerConnection.ontrack = (event) => {
      const [remoteStream] = event.streams;
      setRemoteStreams(prev => new Map(prev.set(userId, remoteStream)));
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          roomId,
          candidate: event.candidate,
          targetUserId: userId
        });
      }
    };

    if (isInitiator) {
      // Create and send offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      socket.emit('offer', {
        roomId,
        offer,
        targetUserId: userId
      });
    }
  };

  const handleOffer = async (data) => {
    const peerConnection = peerConnections.current.get(data.fromUserId);
    if (peerConnection) {
      await peerConnection.setRemoteDescription(data.offer);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      socket.emit('answer', {
        roomId,
        answer,
        targetUserId: data.fromUserId
      });
    }
  };

  const handleAnswer = async (data) => {
    const peerConnection = peerConnections.current.get(data.fromUserId);
    if (peerConnection) {
      await peerConnection.setRemoteDescription(data.answer);
    }
  };

  const handleIceCandidate = async (data) => {
    const peerConnection = peerConnections.current.get(data.fromUserId);
    if (peerConnection) {
      await peerConnection.addIceCandidate(data.candidate);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
        socket.emit('toggle-video', { roomId, enabled: videoTrack.enabled });
      }
    }
  };

  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
        socket.emit('toggle-audio', { roomId, enabled: audioTrack.enabled });
      }
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
        
        // Replace video track in all peer connections
        peerConnections.current.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) {
            sender.replaceTrack(screenStream.getVideoTracks()[0]);
          }
        });

        setIsScreenSharing(true);
        socket.emit('start-screen-share', { roomId });

        // Handle screen share end
        screenStream.getVideoTracks()[0].onended = () => {
          stopScreenShare();
        };
      } else {
        stopScreenShare();
      }
    } catch (error) {
      console.error('Error sharing screen:', error);
    }
  };

  const stopScreenShare = async () => {
    if (localStream) {
      // Replace screen track with camera track
      peerConnections.current.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(localStream.getVideoTracks()[0]);
        }
      });
    }
    
    setIsScreenSharing(false);
    socket.emit('stop-screen-share', { roomId });
  };

  const sendMessage = (message) => {
    const messageData = {
      roomId,
      message,
      username,
      timestamp: new Date().toISOString()
    };
    socket.emit('chat-message', messageData);
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setRoomIdCopied(true);
    setTimeout(() => setRoomIdCopied(false), 2000);
  };

  const cleanup = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
  };

  const handleLeaveRoom = () => {
    cleanup();
    onLeaveRoom();
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-semibold text-white">VidMate Call</h1>
            <div className="flex items-center space-x-2">
              <span className="text-gray-400 text-sm">Room:</span>
              <code className="bg-gray-700 px-2 py-1 rounded text-sm text-white">
                {roomId}
              </code>
              <button
                onClick={copyRoomId}
                className="p-1 hover:bg-gray-700 rounded transition-colors"
              >
                {roomIdCopied ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4 text-gray-400" />
                )}
              </button>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowParticipants(!showParticipants)}
              className="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-400 hover:text-white"
            >
              <Users className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowChat(!showChat)}
              className="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-400 hover:text-white"
            >
              <MessageSquare className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Video Area */}
        <div className="flex-1 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 h-full">
            {/* Local Video */}
            <div className="relative bg-gray-800 rounded-lg overflow-hidden">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-sm">
                {username} (You)
              </div>
              {!isVideoEnabled && (
                <div className="absolute inset-0 bg-gray-700 flex items-center justify-center">
                  <VideoOff className="w-12 h-12 text-gray-400" />
                </div>
              )}
            </div>

            {/* Remote Videos */}
            {Array.from(remoteStreams.entries()).map(([userId, stream]) => (
              <div key={userId} className="relative bg-gray-800 rounded-lg overflow-hidden">
                <video
                  ref={el => {
                    if (el && stream) {
                      el.srcObject = stream;
                      remoteVideoRefs.current.set(userId, el);
                    }
                  }}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-sm">
                  {participants.find(p => p.id === userId)?.username || 'Unknown'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat Sidebar */}
        {showChat && (
          <Chat
            messages={messages}
            onSendMessage={sendMessage}
            onClose={() => setShowChat(false)}
          />
        )}

        {/* Participants Sidebar */}
        {showParticipants && (
          <ParticipantsList
            participants={participants}
            currentUser={username}
            onClose={() => setShowParticipants(false)}
          />
        )}
      </div>

      {/* Controls */}
      <div className="bg-gray-800 border-t border-gray-700 p-4">
        <div className="flex items-center justify-center space-x-4">
          <button
            onClick={toggleAudio}
            className={`p-3 rounded-full transition-colors ${
              isAudioEnabled 
                ? 'bg-gray-700 hover:bg-gray-600 text-white' 
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
          >
            {isAudioEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          </button>

          <button
            onClick={toggleVideo}
            className={`p-3 rounded-full transition-colors ${
              isVideoEnabled 
                ? 'bg-gray-700 hover:bg-gray-600 text-white' 
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
          >
            {isVideoEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
          </button>

          <button
            onClick={toggleScreenShare}
            className={`p-3 rounded-full transition-colors ${
              isScreenSharing 
                ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                : 'bg-gray-700 hover:bg-gray-600 text-white'
            }`}
          >
            <Monitor className="w-6 h-6" />
          </button>

          <button
            onClick={handleLeaveRoom}
            className="p-3 rounded-full bg-red-600 hover:bg-red-700 text-white transition-colors"
          >
            <Phone className="w-6 h-6 transform rotate-135" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;