import { Suspense } from 'react';
import ChatWindow from '@/components/ChatWindow';

export default function ChatPage() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] bg-opacity-20 relative">
      <div className="absolute inset-0 bg-gradient-to-br from-[#0d1117] via-[#161b22] to-[#0d1117] -z-10 opacity-80" />
      <Suspense fallback={<div className="text-white p-10">Loading Secure Chat Interface...</div>}>
        <ChatWindow />
      </Suspense>
    </div>
  );
}
