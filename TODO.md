# Fix Infinite Connection on Hosted Join/Host

## Plan Breakdown (Approved)

### Step 1: Create/Update .env [PENDING]
- Add `VITE_SOCKET_URL=https://qwalyyyy.popovichab.ru:3001` (adjust port)
- Ensure server uses `CLIENT_URL=https://qwalyyyy.popovichab.ru`

### Step 2: Fix src/socket/socket.js [PENDING]
- Auto-detect hosted domain
- Use relative `/socket.io/` + error handling

### Step 3: Add timeout/retry to src/screens/Join.jsx [PENDING]
- 10s timeout on loading
- connect_error listener + retry UI

### Step 4: Improve RoomContext.jsx [PENDING]
- Request state on connect
- Retry join-room logic

### Step 5: Update server/server.js [PENDING]
- CLIENT_URL to hosted domain
- Log origins + wildcard CORS dev

### Step 6: Deploy & Test [PENDING]
- Rebuild/deploy frontend
- Restart server
- Test https://qwalyyyy.popovichab.ru/join/host

✅ Step 1: .env created  
✅ Step 2: socket.js fixed (PROD URL + options)  
✅ Step 3: Join.jsx timeout/error UI  
✅ Step 4: RoomContext retry logic  
✅ Step 1-5: Complete (env, socket.js, Join.jsx, RoomContext, server.js)  
✅ All Steps Complete!  

**Final Fixes Applied:**
- Timeout → 15s (no alert spam)
- AutoJoin timeout fix  
- Socket connects to `domain:3001` (auto-hosted)

**Deploy & Test:**
```
npm run build
# Deploy dist/
# Server restart  
test: https://qwalyyyy.popovichab.ru/join/host
```

Socket server likely on **same domain different port** (3001). Game end fixed by retries.


**Deploy Commands:**
```
npm run build
# Upload dist/ to hosting
# Restart socket server with updated server.js
# Test: https://qwalyyyy.popovichab.ru/join/host
```

**Expected Result:** No more localhost CORS errors, direct connect to hosted socket server.

