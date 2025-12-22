const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    index: true
  },
  puzzleId: {
    type: Number,
    required: true
  },
  timeMs: {
    type: Number,
    required: true
  },
  gridSize: {
    type: Number,
    default: null
  },
  numbersCount: {
    type: Number,
    default: null
  }
}, {
  timestamps: true
});

// Compound index: one record per user per puzzle
progressSchema.index({ username: 1, puzzleId: 1 }, { unique: true });

module.exports = mongoose.model('Progress', progressSchema);
