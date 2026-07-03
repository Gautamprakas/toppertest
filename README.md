# TopperTest.com – Government Exam Typing Practice Platform
**By ASI Sandeep** | Full-Stack Node.js + MySQL + Vanilla JS

---

## 🗂 Project Structure

```
toppertest/
├── backend/
│   ├── config/
│   │   ├── db.js              # MySQL connection pool
│   │   └── schema.sql         # Full database schema + seed data
│   ├── controllers/
│   │   ├── authController.js  # Register, Login, Profile
│   │   ├── examController.js  # CRUD for exams
│   │   ├── passageController.js # CRUD for passages
│   │   ├── typingController.js  # Start/Submit test, History, Analytics
│   │   └── adminController.js   # Admin endpoints
│   ├── middlewares/
│   │   └── auth.js            # JWT auth & admin guard
│   ├── routes/
│   │   └── index.js           # All API routes
│   ├── server.js              # Express entry point
│   ├── package.json
│   └── .env.example           # Environment variables template
└── frontend/
    ├── css/
    │   └── style.css          # Main stylesheet
    ├── js/
    │   └── app.js             # Global utilities, Auth, API helper
    └── pages/
        ├── index.html         # Home page (SEO optimized)
        ├── login.html         # Login page
        ├── register.html      # Registration page
        ├── dashboard.html     # User dashboard with charts
        ├── select-exam.html   # 4-step exam selection flow
        ├── instructions.html  # Test instructions page
        ├── typing-test.html   # Live typing test window
        ├── history.html       # Typing history with pagination
        ├── leaderboard.html   # National leaderboard
        ├── exams.html         # All exams listing (SEO)
        └── admin.html         # Admin panel (passage/exam management)
```

---

## 🚀 Quick Setup

### 1. MySQL Setup
```sql
-- Run schema
mysql -u root -p < backend/config/schema.sql
```

### 2. Backend Setup
```bash
cd backend
cp .env.example .env
# Edit .env with your MySQL credentials and JWT secret
npm install
npm start
# Dev mode: npm run dev
```

### 3. Environment Variables (.env)
```
PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASS=your_password
DB_NAME=toppertest
JWT_SECRET=your_super_secret_key_change_this_in_production
ALLOWED_ORIGIN=https://toppertest.com
```

### 4. Frontend
The frontend is static HTML/CSS/JS served by Express.
No build step required. Place `frontend/` in project root.

---

## 🔑 Default Admin Account
```
Email:    admin@toppertest.com
Password: Admin@123
```
**⚠️ Change this password immediately after first login!**

---

## 📡 API Reference

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/register | Register new user |
| POST | /api/login | Login, returns JWT |
| GET  | /api/profile | Get profile (auth required) |

### Public
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/exams | List all active exams |
| GET | /api/passages?exam_id=&language=&date= | Filter passages |
| GET | /api/passages/dates?exam_id=&language= | Available dates |
| GET | /api/stats | Site-wide stats |
| GET | /api/leaderboard?exam_id= | Leaderboard |

### Typing Test (Auth Required)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | /api/passages/:id | Get passage for test |
| POST | /api/start-test | Start a test session |
| POST | /api/submit-test | Submit and get results |
| GET  | /api/history | Typing history |
| GET  | /api/analytics | Performance analytics |

### Admin Only
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/exams | Create exam |
| PUT  | /api/exams/:id | Update exam |
| DELETE | /api/exams/:id | Deactivate exam |
| POST | /api/passages | Add passage |
| PUT  | /api/passages/:id | Update passage |
| DELETE | /api/passages/:id | Deactivate passage |
| GET  | /api/admin/users | All users |
| GET  | /api/admin/user-stats | User stats |
| GET  | /api/admin/results | All results |
| GET  | /api/admin/site-stats | Dashboard stats |

---

## 🌐 Production Deployment (VPS/Ubuntu)

### 1. Server Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install MySQL
sudo apt install -y mysql-server
sudo mysql_secure_installation

# Install PM2 (process manager)
npm install -g pm2
```

### 2. Nginx Config
```nginx
server {
    listen 80;
    server_name toppertest.com www.toppertest.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. SSL with Certbot
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d toppertest.com -d www.toppertest.com
```

### 4. Start with PM2
```bash
cd backend
pm2 start server.js --name toppertest
pm2 startup
pm2 save
```

---

## 📈 Scaling for Thousands of Students

- **Connection Pooling**: MySQL pool configured with 20 connections
- **Rate Limiting**: Auth: 20 req/15min | API: 200 req/min  
- **PM2 Cluster**: `pm2 start server.js -i max` (uses all CPU cores)
- **Redis Session Store**: Add Redis for high-traffic JWT caching
- **CDN**: Use Cloudflare for static assets
- **MySQL Optimization**: Indexes on all query columns in schema

---

## 🔒 Security Features

- ✅ Passwords hashed with bcrypt (salt rounds: 10)
- ✅ JWT authentication with 7-day expiry
- ✅ Rate limiting on all endpoints
- ✅ Helmet.js security headers
- ✅ CORS configured for specific origin
- ✅ Session tokens for test integrity
- ✅ Frontend: no copy-paste, no right-click
- ✅ Tab switch detection
- ✅ Admin role guard on all admin routes

---

## 🎯 SEO Features

- H1/H2/H3 optimized headings on every page
- Meta title and description on all pages
- Open Graph tags for social sharing
- Schema.org JSON-LD markup
- Canonical URLs
- Keyword-rich content on exams.html
- FAQ schema on exams page

---

## 📺 YouTube Integration
ASI Sandeep's YouTube channel link is integrated in the homepage CTA section.
Update the YouTube URL in `index.html` to your actual channel URL.
"# toppertest" 
