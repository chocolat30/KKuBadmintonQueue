# Badminton Queue Management System

A lightweight web-based queue and match management system for badminton courts in KKU.  
Designed base on the local house rule.

Built with **Node.js, Express, SQLite, and EJS**.

---

## Features

### Court Management
- Add / delete courts
- Each court has its **own queue, match, and history**
- QR Code for quick court access (Local site)

### Queue System
- Join queue by pair name
- Move queue up / down
- Remove specific pairs
- Clear entire queue
- Inline name editing

### Match Control (For house rule)
- Start match with first 2 pairs
- Track matches played per team 
- Add / subtract match counts
- End match and auto-rotate queue
- Reset current match back to queue

### History
- Match history per court
- Global match history
- Clear history (court-specific or global)

### Undo System
- Undo last action 
- Restores:
  - Queue
  - Current match
  - Recent match history
Prevents accidental data loss

---

## Design Goals

- No queue corruption
- No race conditions
- Court-isolated data
- Simple UI for mobile use
- Zero client-side frameworks

---

## Tech Stack

| Layer        | Tech |
|-------------|------|
| Backend     | Node.js + Express |
| Database    | SQLite |
| View Engine | EJS |
| UI          | Bootstrap 5 |
| QR Code     | qrcodejs |

---

## Project Structure

```
/
    server.js
    db.js
    database.sqlite
    views/
        courts.ejs
        queue.ejs
        history.ejs
    public/
        (static files)
    README.md
```

---

## Installation

### 1 Clone the repository
```bash
git clone https://github.com/chocolat30/KKuBadmintonQueue.git
cd KKuBadmintonQueue/
```

### 2 Install dependencies
```bash
npm install
```

### 3 Start the server
```bash
node server.js
```

### 4 Open in browser
```
http://localhost:3000
```

---

## Mobile Usage
- Open a court page
- Create a court
- Scan the court's QR code
- Share with players to join queue directly

---

## Tested Scenarios

- [x] Rapid queue edits  
- [x] Undo after mistakes  
- [x] Match reset  
- [x] Empty queue edge cases  
- [x] Mobile screen layouts  

---

## Data Safety

- All operations are court-scoped
- Undo snapshot before destructive actions
- No cross-court data leaks

---

## Future Improvements (Ideas)

- WebSocket live updates
- Player statistics
- Court availability dashboard
- Auth / admin mode
- Multi-language UI

---

## Author

**P. Raccoon**  
---
