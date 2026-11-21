import "@/App.css";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Show, SignIn, SignUp } from "@clerk/react";
import { Toaster } from "@/components/ui/sonner";
import ClerkAuthProvider from "@/components/auth/ClerkAuthProvider";
import { AdamProvider } from "@/lib/adamContext";
import Shell from "@/components/adam/Shell";
import AuthLayout from "@/pages/AuthLayout";
import ChatPage from "@/pages/ChatPage";
import MemoryPage from "@/pages/MemoryPage";
import LabPage from "@/pages/LabPage";
import ApiPage from "@/pages/ApiPage";
import SettingsPage from "@/pages/SettingsPage";
import FilesPage from "@/pages/FilesPage";
import KnowledgePage from "@/pages/KnowledgePage";
import ExtensionPage from "@/pages/ExtensionPage";
import WidgetPage from "@/pages/WidgetPage";

function Protected() {
  return (
    <>
      <Show when="signed-in">
        <AdamProvider><Shell /></AdamProvider>
      </Show>
      <Show when="signed-out"><Navigate to="/sign-in" replace /></Show>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ClerkAuthProvider>
        <Routes>
          <Route path="/sign-in/*" element={<AuthLayout><SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" withSignUp /></AuthLayout>} />
          <Route path="/sign-up/*" element={<AuthLayout><SignUp routing="path" path="/sign-up" signInUrl="/sign-in" /></AuthLayout>} />
          <Route element={<Protected />}>
            <Route path="/" element={<ChatPage />} />
            <Route path="/chat/:id" element={<ChatPage />} />
            <Route path="/memoria" element={<MemoryPage />} />
            <Route path="/conhecimento" element={<KnowledgePage />} />
            <Route path="/extensao" element={<ExtensionPage />} />
            <Route path="/widget" element={<WidgetPage />} />
            <Route path="/arquivos" element={<FilesPage />} />
            <Route path="/laboratorio" element={<LabPage />} />
            <Route path="/api" element={<ApiPage />} />
            <Route path="/configuracoes" element={<SettingsPage />} />
          </Route>
        </Routes>
        <Toaster theme="dark" position="top-right" />
      </ClerkAuthProvider>
    </BrowserRouter>
  );
}

export default App;
