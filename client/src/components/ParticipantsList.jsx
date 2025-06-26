import { X, Mic, MicOff, Video, VideoOff, User } from 'lucide-react';

const ParticipantsList = ({ participants, currentUser, onClose }) => {
  return (
    <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h3 className="text-lg font-semibold text-white">
          Participants ({participants.length + 1})
        </h3>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-700 rounded transition-colors"
        >
          <X className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      {/* Participants List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {/* Current User */}
          <div className="flex items-center space-x-3 p-3 bg-gray-700 rounded-lg">
            <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
              <User className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-white font-medium">{currentUser} (You)</p>
              <p className="text-gray-400 text-sm">Host</p>
            </div>
            <div className="flex space-x-1">
              <Mic className="w-4 h-4 text-green-400" />
              <Video className="w-4 h-4 text-green-400" />
            </div>
          </div>

          {/* Other Participants */}
          {participants.map((participant) => (
            <div key={participant.id} className="flex items-center space-x-3 p-3 bg-gray-700 rounded-lg">
              <div className="w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center">
                <User className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-white font-medium">{participant.username}</p>
                <p className="text-gray-400 text-sm">Participant</p>
              </div>
              <div className="flex space-x-1">
                <Mic className="w-4 h-4 text-green-400" />
                <Video className="w-4 h-4 text-green-400" />
              </div>
            </div>
          ))}

          {participants.length === 0 && (
            <div className="text-center text-gray-400 mt-8">
              <p>No other participants</p>
              <p className="text-sm">Share the room ID to invite others</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ParticipantsList;