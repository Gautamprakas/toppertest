const express = require('express');
const router  = express.Router();

const authCtrl    = require('../controllers/authController');
const examCtrl    = require('../controllers/examController');
const passCtrl    = require('../controllers/passageController');
const typingCtrl  = require('../controllers/typingController');
const adminCtrl   = require('../controllers/adminController');
const { auth, adminAuth, optionalAuth } = require('../middlewares/auth');

/* ── Auth ──────────────────────────────────────────────────────────────────── */
router.post('/register', authCtrl.register);
router.post('/login',    authCtrl.login);
router.get('/profile',   auth, authCtrl.profile);

/* ── Public Stats ──────────────────────────────────────────────────────────── */
router.get('/stats',       typingCtrl.getDashboardStats);
router.get('/leaderboard', typingCtrl.getLeaderboard);

/* ── Exams ─────────────────────────────────────────────────────────────────── */
router.get('/exams',          examCtrl.getExams);
router.get('/exams/:id',      examCtrl.getExam);
router.post('/exams',                           adminAuth, examCtrl.createExam);
router.put('/exams/:id',                        adminAuth, examCtrl.updateExam);
router.delete('/exams/:id',                     adminAuth, examCtrl.deleteExam);
router.patch('/exams/:id/toggle-highlighting',  adminAuth, examCtrl.toggleHighlighting);

/* ── Passages ──────────────────────────────────────────────────────────────── */
router.get('/passages',         passCtrl.getPassages);
router.get('/passages/dates',   passCtrl.getPassageDates);
router.get('/passages/:id',     auth, passCtrl.getPassage);
router.post('/passages',        adminAuth, passCtrl.createPassage);
router.put('/passages/:id',     adminAuth, passCtrl.updatePassage);
router.delete('/passages/:id',  adminAuth, passCtrl.deletePassage);

/* ── Typing Test ───────────────────────────────────────────────────────────── */
router.post('/start-test',  auth, typingCtrl.startTest);
router.post('/submit-test', auth, typingCtrl.submitTest);
router.get('/history',      auth, typingCtrl.getHistory);
router.get('/analytics',    auth, typingCtrl.getAnalytics);

/* ── Admin ─────────────────────────────────────────────────────────────────── */
router.get('/admin/users',       adminAuth, adminCtrl.getUsers);
router.get('/admin/user-stats',  adminAuth, adminCtrl.getUserStats);
router.patch('/admin/users/:id/toggle', adminAuth, adminCtrl.toggleUser);
router.get('/admin/results',     adminAuth, adminCtrl.getAllResults);
router.get('/admin/site-stats',  adminAuth, adminCtrl.getSiteStats);

module.exports = router;

/* ── Live Exams ────────────────────────────────────────────────────────────── */
const liveCtrl = require('../controllers/liveExamController');
router.get('/live-exams',                             auth,      liveCtrl.getLiveExams);
router.get('/live-exams/:id',                         auth,      liveCtrl.getLiveExam);
router.post('/live-exams',                            adminAuth, liveCtrl.createLiveExam);
router.delete('/live-exams/:id',                      adminAuth, liveCtrl.deleteLiveExam);
router.post('/live-exams/:id/join',                   auth,      liveCtrl.joinLiveExam);
router.post('/live-exams/:id/release-results',        adminAuth, liveCtrl.releaseResults);
router.get('/live-exams/:id/results',                 auth,      liveCtrl.getLiveExamResults);
router.patch('/live-exams/:id/mark-attempt-submitted',auth,      liveCtrl.markAttemptSubmitted);

/* ── Mock Test Series (UPP written-exam MCQ mocks) ─────────────────────────── */
const mockCtrl = require('../controllers/mockTestController');
// Student
router.get('/test-series',               mockCtrl.getSeriesList);
router.get('/test-series/:id/scorecard', auth,         mockCtrl.getSeriesScorecard);
router.get('/test-series/:id',           optionalAuth, mockCtrl.getSeriesDetail);
router.post('/mock-tests/:id/start',     auth,         mockCtrl.startMockTest);
router.post('/mock-tests/:id/submit',    auth,         mockCtrl.submitMockTest);
router.get('/mock-attempts/:id/review',  auth,         mockCtrl.reviewAttempt);
// Admin
router.post('/admin/test-series',                    adminAuth, mockCtrl.adminCreateSeries);
router.put('/admin/test-series/:id',                 adminAuth, mockCtrl.adminUpdateSeries);
router.delete('/admin/test-series/:id',              adminAuth, mockCtrl.adminDeleteSeries);
router.post('/admin/mock-tests',                     adminAuth, mockCtrl.adminCreateTest);
router.put('/admin/mock-tests/:id',                  adminAuth, mockCtrl.adminUpdateTest);
router.delete('/admin/mock-tests/:id',               adminAuth, mockCtrl.adminDeleteTest);
router.get('/admin/mock-tests/:id/questions',        adminAuth, mockCtrl.adminGetQuestions);
router.post('/admin/mock-tests/:id/questions',       adminAuth, mockCtrl.adminCreateQuestion);
router.post('/admin/mock-tests/:id/questions/bulk',  adminAuth, mockCtrl.adminBulkImportQuestions);
router.put('/admin/questions/:id',                   adminAuth, mockCtrl.adminUpdateQuestion);
router.delete('/admin/questions/:id',                adminAuth, mockCtrl.adminDeleteQuestion);
