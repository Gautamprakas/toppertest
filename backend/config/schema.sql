-- ============================================================
-- TopperTest.com - Government Exam Typing Practice Platform
-- Database Schema by ASI Sandeep
-- ============================================================

CREATE DATABASE IF NOT EXISTS toppertest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE toppertest;

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    email       VARCHAR(150) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    role        ENUM('student','admin') DEFAULT 'student',
    phone       VARCHAR(15),
    avatar_url  VARCHAR(255),
    is_active   TINYINT(1) DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_role (role)
);

-- ============================================================
-- EXAMS TABLE
-- ============================================================
CREATE TABLE exams (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    exam_name         VARCHAR(150) NOT NULL,
    exam_code         VARCHAR(50) NOT NULL UNIQUE,
    language          ENUM('hindi','english','both') DEFAULT 'both',
    duration_minutes  INT NOT NULL DEFAULT 15,
    word_limit        INT NOT NULL DEFAULT 250,
    description       TEXT,
    is_active         TINYINT(1) DEFAULT 1,
    sort_order        INT DEFAULT 0,
    enable_highlighting TINYINT(1) DEFAULT 1,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_exam_code (exam_code),
    INDEX idx_active (is_active)
);

-- ============================================================
-- PASSAGES TABLE
-- ============================================================
CREATE TABLE passages (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    exam_id       INT NOT NULL,
    passage_text  LONGTEXT NOT NULL,
    language      ENUM('hindi','english') NOT NULL DEFAULT 'english',
    difficulty    ENUM('E','M','H') NOT NULL DEFAULT 'M',
    passage_date  DATE,
    word_count    INT NOT NULL DEFAULT 0,
    title         VARCHAR(200),
    shift         VARCHAR(50),
    is_active     TINYINT(1) DEFAULT 1,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
    INDEX idx_exam_lang (exam_id, language),
    INDEX idx_date (passage_date),
    INDEX idx_difficulty (difficulty)
);

-- ============================================================
-- TYPING SESSIONS (started tests)
-- ============================================================
CREATE TABLE typing_sessions (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    exam_id     INT NOT NULL,
    passage_id  INT NOT NULL,
    started_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    status      ENUM('active','submitted','abandoned') DEFAULT 'active',
    session_token VARCHAR(64) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (exam_id) REFERENCES exams(id),
    FOREIGN KEY (passage_id) REFERENCES passages(id),
    INDEX idx_user_active (user_id, status),
    INDEX idx_session_token (session_token)
);

-- ============================================================
-- TYPING RESULTS TABLE
-- ============================================================
CREATE TABLE typing_results (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL,
    exam_id       INT NOT NULL,
    passage_id    INT NOT NULL,
    session_id    INT,
    typed_text    LONGTEXT,
    total_words   INT DEFAULT 0,
    correct_words INT DEFAULT 0,
    wrong_words   INT DEFAULT 0,
    wpm           DECIMAL(6,2) DEFAULT 0.00,
    accuracy      DECIMAL(5,2) DEFAULT 0.00,
    errors        INT DEFAULT 0,
    time_taken    INT DEFAULT 0 COMMENT 'seconds',
    keystrokes    INT DEFAULT 0,
    backspaces    INT DEFAULT 0,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (exam_id) REFERENCES exams(id),
    FOREIGN KEY (passage_id) REFERENCES passages(id),
    INDEX idx_user_results (user_id, created_at),
    INDEX idx_leaderboard (exam_id, wpm)
);

-- ============================================================
-- DAILY CHALLENGES TABLE
-- ============================================================
CREATE TABLE daily_challenges (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    passage_id   INT NOT NULL,
    challenge_date DATE NOT NULL UNIQUE,
    is_active    TINYINT(1) DEFAULT 1,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (passage_id) REFERENCES passages(id)
);

-- ============================================================
-- LIVE EXAMS TABLE
-- ============================================================
CREATE TABLE live_exams (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    title             VARCHAR(200) NOT NULL,
    exam_id           INT NOT NULL,
    passage_id        INT NOT NULL,
    scheduled_at      DATETIME NOT NULL,
    join_window_mins  INT NOT NULL DEFAULT 10,
    duration_minutes  INT NOT NULL DEFAULT 15,
    description       TEXT,
    created_by        INT NOT NULL,
    results_released  TINYINT(1) DEFAULT 0,
    status            VARCHAR(30) DEFAULT 'scheduled',
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (exam_id) REFERENCES exams(id),
    FOREIGN KEY (passage_id) REFERENCES passages(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    INDEX idx_scheduled_at (scheduled_at)
);

-- ============================================================
-- LIVE EXAM ATTEMPTS TABLE
-- ============================================================
CREATE TABLE live_exam_attempts (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    live_exam_id  INT NOT NULL,
    user_id       INT NOT NULL,
    session_id    INT,
    result_id     INT,
    joined_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    submitted_at  DATETIME,
    FOREIGN KEY (live_exam_id) REFERENCES live_exams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES typing_sessions(id),
    FOREIGN KEY (result_id) REFERENCES typing_results(id),
    UNIQUE KEY uniq_live_exam_user (live_exam_id, user_id),
    INDEX idx_live_exam (live_exam_id)
);

-- ============================================================
-- LEADERBOARD VIEW
-- ============================================================
CREATE OR REPLACE VIEW leaderboard_view AS
SELECT
    u.id AS user_id,
    u.name,
    e.exam_name,
    MAX(r.wpm) AS best_wpm,
    ROUND(AVG(r.accuracy), 2) AS avg_accuracy,
    COUNT(r.id) AS total_tests,
    MAX(r.created_at) AS last_test
FROM typing_results r
JOIN users u ON r.user_id = u.id
JOIN exams e ON r.exam_id = e.id
GROUP BY u.id, e.id
ORDER BY best_wpm DESC;

-- ============================================================
-- SAMPLE EXAM DATA
-- ============================================================
INSERT INTO exams (exam_name, exam_code, language, duration_minutes, word_limit, description, sort_order) VALUES
('UPP ASI / SI Hindi Typing',            'UPP_ASI_SI_HINDI',   'hindi',   15, 250, 'Uttar Pradesh Police ASI/SI Hindi Mangal typing test practice',  1),
('UPP ASI / SI English Typing',          'UPP_ASI_SI_ENGLISH', 'english', 15, 510, 'Uttar Pradesh Police ASI/SI English typing test practice',       2),
('UPP Computer Operator Hindi Typing',   'UPP_CO_HINDI',       'hindi',   15, 250, 'UP Police Computer Operator Hindi Mangal typing test practice',  3),
('UPP Computer Operator English Typing', 'UPP_CO_ENGLISH',     'english', 15, 510, 'UP Police Computer Operator English typing test practice',       4);

-- ============================================================
-- SAMPLE PASSAGES
-- ============================================================
INSERT INTO passages (exam_id, passage_text, language, difficulty, passage_date, word_count, title) VALUES
(1, 'उत्तर प्रदेश पुलिस भर्ती एवं प्रोन्नति बोर्ड द्वारा आयोजित आशुलिपि एवं टंकण परीक्षा में सम्मिलित होने वाले अभ्यर्थियों को यह सुनिश्चित करना होगा कि वे निर्धारित गति एवं शुद्धता के मानकों को पूरा करते हैं। परीक्षा में सफलता प्राप्त करने के लिए नियमित अभ्यास अत्यंत आवश्यक है। प्रतिदिन कम से कम दो घंटे टंकण का अभ्यास करने से गति और शुद्धता दोनों में सुधार होता है।', 'hindi', 'M', '2024-01-15', 80, 'UPP ASI/SI Hindi Practice Sample'),
(2, 'The Uttar Pradesh Police Recruitment and Promotion Board conducts typing examinations to recruit candidates for various posts in the state police department. The typing test is an important component of the selection process for posts that require data entry skills. Candidates must practice regularly to achieve the required speed with high accuracy before appearing in the examination.', 'english', 'E', '2024-01-15', 60, 'UPP ASI/SI English Practice Sample'),
(3, 'कम्प्यूटर ऑपरेटर पद की परीक्षा में टंकण की महत्वपूर्ण भूमिका होती है। अभ्यर्थी को शुद्ध एवं तीव्र गति से टंकण करने में दक्ष होना चाहिए। हिंदी टंकण में मंगल फॉन्ट का प्रयोग किया जाता है जो यूनिकोड आधारित फॉन्ट है। इसमें इनस्क्रिप्ट कीबोर्ड लेआउट का प्रयोग होता है जिसे सीखना आवश्यक है।', 'hindi', 'H', '2024-01-15', 60, 'UPP Computer Operator Hindi Practice Sample');

-- Admin user (password: Admin@123)
INSERT INTO users (name, email, password, role) VALUES
('ASI Sandeep', 'admin@toppertest.com', '$2b$10$rQZ8kHUqbGkQdGiHCi8mVOJSqIwnPb9LpIp5Q.AYqoFGxhbFV3nAe', 'admin');
