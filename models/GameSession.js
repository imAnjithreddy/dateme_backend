const mongoose = require('mongoose');

const gameSessionSchema = new mongoose.Schema(
  {
    gameType: {
      type: String,
      enum: ['tictactoe', 'trivia'],
      required: true
    },
    inviter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    invitee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    connection: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Connection'
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'completed', 'declined', 'cancelled'],
      default: 'pending'
    },
    gameState: {
      // For Tic-Tac-Toe:
      // board: ['','','','','','','','','']
      // currentTurn: userId
      // winner: null | 'X' | 'O' | 'draw'
      // symbols: { [userId]: 'X' | 'O' }
      //
      // For Trivia:
      // currentQuestionIndex: 0
      // questions: [...]
      // answers: { [userId]: [selectedOptionIndexes] }
      // scores: { [userId]: number }
      //
      // Shared:
      // icebreakerPrompt: string (encourages friendly conversation!)
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    completedAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('GameSession', gameSessionSchema);
