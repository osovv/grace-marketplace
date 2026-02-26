#!/bin/bash
# Start both backend and frontend for local development

echo "=== EPC Planning Automation Engine ==="
echo ""

# Start backend
echo "Starting backend..."
cd backend
pip install -q -r requirements.txt 2>/dev/null
cd app
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ../..

# Start frontend
echo "Starting frontend..."
cd frontend
npm install --silent 2>/dev/null
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:5173"
echo "API Docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT
wait
