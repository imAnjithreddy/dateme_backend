const GameSession = require('../models/GameSession');
const User = require('../models/User');
const Connection = require('../models/Connection');
const Notification = require('../models/Notification');
const notificationService = require('../services/notificationService');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { awardParticipationXp } = require('../services/gamificationService');

const ICEBREAKER_PROMPTS = [
  'What is your go-to comfort food on a rainy campus evening?',
  'Are you more of an early morning library grinder or a 2 AM midnight thinker?',
  'What is the best concert or live music set you have ever experienced?',
  'If you could teleport to any city in the world this weekend, where are you going?',
  'What is an underrated movie or series that everyone needs to watch?',
  'Coffee, matcha, boba, or midnight iced tea?',
  'What is your favorite spot to chill and people-watch around campus?',
  'What is a skill or hobby you have always wanted to master?'
];

const TRIVIA_QUESTION_BANK = [
  {
    question: 'In a survey of college dates, what was voted the #1 best low-pressure first encounter?',
    options: ['Lively Coffee & Pastry Walk', '3-Hour Formal Dinner', 'Cinema Movie with No Talking', 'Library Silence Study'],
    correctIndex: 0,
    chatSpark: 'Do you agree that a casual coffee stroll is the most relaxed first date vibe?'
  },
  {
    question: 'Which legendary album by Daft Punk features the classic late-night anthem "One More Time"?',
    options: ['Discovery', 'Homework', 'Random Access Memories', 'Human After All'],
    correctIndex: 0,
    chatSpark: 'What is your absolute favorite music track to put on headphones to?'
  },
  {
    question: 'Which game is famously known as the oldest recorded board game in human history?',
    options: ['The Royal Game of Ur', 'Chess', 'Monopoly', 'Scrabble'],
    correctIndex: 0,
    chatSpark: 'Are you more into classic board games, video games, or outdoor yard games?'
  },
  {
    question: 'What psychological phenomenon describes feeling more connected to someone after sharing an adrenaline rush or fun game?',
    options: ['Misattribution of Arousal', 'The Halo Effect', 'Confirmation Bias', 'Mirroring Principle'],
    correctIndex: 0,
    chatSpark: 'Playing games together really is one of the best icebreakers to get to know someone!'
  },
  {
    question: 'Which film studio is famous for distinctive indie hits like "Everything Everywhere All At Once" and "Past Lives"?',
    options: ['A24', 'Warner Bros', 'Pixar', 'Universal'],
    correctIndex: 0,
    chatSpark: 'What is your favorite indie film or movie genre?'
  }
];

// Helper to check 3x3 tic-tac-toe win
const checkTicTacToeWinner = (board) => {
  const winLines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
    [0, 4, 8], [2, 4, 6]             // diagonals
  ];

  for (const [a, b, c] of winLines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a]; // 'X' or 'O'
    }
  }

  if (board.every((cell) => cell !== null && cell !== '')) {
    return 'draw';
  }

  return null;
};

/**
 * Send an invitation to play a mini-game
 * POST /api/games/invite
 */
const createInvite = async (req, res, next) => {
  try {
    const { targetUserId, gameType = 'tictactoe', connectionId } = req.body;

    if (!targetUserId) {
      return errorResponse(res, 'Target user ID is required.', 400);
    }

    if (targetUserId === req.user._id.toString()) {
      return errorResponse(res, 'You cannot invite yourself to a game.', 400);
    }

    const invitee = await User.findById(targetUserId);
    if (!invitee) {
      return errorResponse(res, 'Target user not found.', 404);
    }

    // Build initial game state
    let initialGameState = {};
    if (gameType === 'tictactoe') {
      initialGameState = {
        board: Array(9).fill(null),
        currentTurn: req.user._id.toString(),
        symbols: {
          [req.user._id.toString()]: 'X',
          [targetUserId]: 'O'
        },
        winner: null,
        icebreakerPrompt: ICEBREAKER_PROMPTS[Math.floor(Math.random() * ICEBREAKER_PROMPTS.length)]
      };
    } else if (gameType === 'trivia') {
      initialGameState = {
        currentQuestionIndex: 0,
        questions: TRIVIA_QUESTION_BANK,
        answers: {
          [req.user._id.toString()]: [],
          [targetUserId]: []
        },
        scores: {
          [req.user._id.toString()]: 0,
          [targetUserId]: 0
        },
        completed: false,
        icebreakerPrompt: TRIVIA_QUESTION_BANK[0].chatSpark
      };
    }

    const session = await GameSession.create({
      gameType,
      inviter: req.user._id,
      invitee: targetUserId,
      connection: connectionId || null,
      status: 'pending',
      gameState: initialGameState
    });

    const populated = await GameSession.findById(session._id)
      .populate('inviter', 'name displayName avatar')
      .populate('invitee', 'name displayName avatar');

    // Notify invitee via Notification
    await notificationService.createAndEmitNotification({
      recipient: targetUserId,
      sender: req.user._id,
      type: 'game_invite',
      title: `Mini-Game Invite: ${gameType === 'tictactoe' ? 'Tic-Tac-Toe' : 'Campus Trivia'} 🎮`,
      message: `${req.user.name} wants to play a round of ${gameType === 'tictactoe' ? 'Tic-Tac-Toe' : 'Campus Trivia'} with you!`,
      data: {
        gameSessionId: session._id,
        gameType,
        actionUrl: '/messages'
      }
    });

    return successResponse(
      res,
      { session: populated },
      `Invitation to play ${gameType === 'tictactoe' ? 'Tic-Tac-Toe' : 'Trivia'} sent!`,
      201
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Respond to game invitation (accept / decline)
 * POST /api/games/:id/respond
 */
const respondInvite = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'accept' | 'decline'

    const session = await GameSession.findById(id)
      .populate('inviter', 'name displayName avatar')
      .populate('invitee', 'name displayName avatar');

    if (!session) {
      return errorResponse(res, 'Game session not found.', 404);
    }

    if (session.invitee._id.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'You are not authorized to respond to this game invite.', 403);
    }

    if (action === 'accept') {
      session.status = 'active';

      // Award XP & Game Night badge to both participants
      const inviterId = session.inviter._id || session.inviter;
      const inviteeId = session.invitee._id || session.invitee;
      await awardParticipationXp(inviterId, `played_game_${session._id}`, 60, { badgeId: 'game_night' });
      await awardParticipationXp(inviteeId, `played_game_${session._id}`, 60, { badgeId: 'game_night' });
    } else {
      session.status = 'declined';
    }

    await session.save();

    return successResponse(
      res,
      { session },
      action === 'accept' ? 'Game started!' : 'Game invite declined.'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get game session state
 * GET /api/games/:id
 */
const getGameSession = async (req, res, next) => {
  try {
    const session = await GameSession.findById(req.params.id)
      .populate('inviter', 'name displayName avatar')
      .populate('invitee', 'name displayName avatar');

    if (!session) {
      return errorResponse(res, 'Game session not found.', 404);
    }

    const userId = req.user._id.toString();
    const isParticipant =
      session.inviter._id.toString() === userId ||
      session.invitee._id.toString() === userId;

    if (!isParticipant) {
      return errorResponse(res, 'You are not a participant in this game.', 403);
    }

    return successResponse(res, { session }, 'Game session retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Submit a move or trivia answer
 * POST /api/games/:id/move
 */
const submitMove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { cellIndex, answerIndex } = req.body;
    const userId = req.user._id.toString();

    const session = await GameSession.findById(id)
      .populate('inviter', 'name displayName avatar')
      .populate('invitee', 'name displayName avatar');

    if (!session || session.status !== 'active') {
      return errorResponse(res, 'Active game session not found.', 404);
    }

    const isParticipant =
      session.inviter._id.toString() === userId ||
      session.invitee._id.toString() === userId;

    if (!isParticipant) {
      return errorResponse(res, 'Not authorized.', 403);
    }

    const state = session.gameState || {};

    if (session.gameType === 'tictactoe') {
      if (cellIndex === undefined || cellIndex < 0 || cellIndex > 8) {
        return errorResponse(res, 'Valid cell index (0-8) required.', 400);
      }

      if (state.currentTurn !== userId) {
        return errorResponse(res, "It's not your turn!", 400);
      }

      if (state.board[cellIndex] !== null && state.board[cellIndex] !== '') {
        return errorResponse(res, 'Cell is already occupied.', 400);
      }

      const playerSymbol = state.symbols[userId];
      state.board[cellIndex] = playerSymbol;

      const winner = checkTicTacToeWinner(state.board);
      state.winner = winner;

      if (winner) {
        session.status = 'completed';
        session.completedAt = new Date();
      } else {
        // Toggle turn
        const otherPlayerId =
          session.inviter._id.toString() === userId
            ? session.invitee._id.toString()
            : session.inviter._id.toString();
        state.currentTurn = otherPlayerId;
        state.icebreakerPrompt = ICEBREAKER_PROMPTS[Math.floor(Math.random() * ICEBREAKER_PROMPTS.length)];
      }

      session.gameState = state;
      session.markModified('gameState');
      await session.save();

      return successResponse(res, { session }, 'Move made successfully');
    } else if (session.gameType === 'trivia') {
      if (answerIndex === undefined) {
        return errorResponse(res, 'Answer index required.', 400);
      }

      const currentQIdx = state.currentQuestionIndex || 0;
      const currentQ = state.questions[currentQIdx];

      if (!state.answers) state.answers = {};
      if (!state.answers[userId]) state.answers[userId] = [];
      state.answers[userId][currentQIdx] = answerIndex;

      if (!state.scores) state.scores = {};
      if (state.scores[userId] === undefined) state.scores[userId] = 0;
      if (answerIndex === currentQ.correctIndex) {
        state.scores[userId] += 1;
      }

      // Check if both players answered current question
      const p1 = session.inviter._id.toString();
      const p2 = session.invitee._id.toString();
      const p1Answered = state.answers[p1]?.[currentQIdx] !== undefined;
      const p2Answered = state.answers[p2]?.[currentQIdx] !== undefined;

      if (p1Answered && p2Answered) {
        if (currentQIdx + 1 < state.questions.length) {
          state.currentQuestionIndex += 1;
          state.icebreakerPrompt = state.questions[state.currentQuestionIndex].chatSpark;
        } else {
          session.status = 'completed';
          session.completedAt = new Date();
        }
      }

      session.gameState = state;
      session.markModified('gameState');
      await session.save();

      return successResponse(res, { session }, 'Trivia answer submitted');
    }

    return errorResponse(res, 'Unknown game type', 400);
  } catch (error) {
    next(error);
  }
};

/**
 * Reset / rematch game
 * POST /api/games/:id/reset
 */
const resetGame = async (req, res, next) => {
  try {
    const { id } = req.params;
    const session = await GameSession.findById(id)
      .populate('inviter', 'name displayName avatar')
      .populate('invitee', 'name displayName avatar');

    if (!session) {
      return errorResponse(res, 'Game session not found.', 404);
    }

    const inviterId = session.inviter._id.toString();
    const inviteeId = session.invitee._id.toString();

    if (session.gameType === 'tictactoe') {
      session.gameState = {
        board: Array(9).fill(null),
        currentTurn: inviterId,
        symbols: { [inviterId]: 'X', [inviteeId]: 'O' },
        winner: null,
        icebreakerPrompt: ICEBREAKER_PROMPTS[Math.floor(Math.random() * ICEBREAKER_PROMPTS.length)]
      };
    } else if (session.gameType === 'trivia') {
      session.gameState = {
        currentQuestionIndex: 0,
        questions: TRIVIA_QUESTION_BANK,
        answers: { [inviterId]: [], [inviteeId]: [] },
        scores: { [inviterId]: 0, [inviteeId]: 0 },
        completed: false,
        icebreakerPrompt: TRIVIA_QUESTION_BANK[0].chatSpark
      };
    }

    session.status = 'active';
    session.markModified('gameState');
    await session.save();

    return successResponse(res, { session }, 'Game reset for a new round!');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createInvite,
  respondInvite,
  getGameSession,
  submitMove,
  resetGame
};
