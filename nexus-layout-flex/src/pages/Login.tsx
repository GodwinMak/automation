import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Network, Sun, Moon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuthContext } from "@/hooks/useAuthContext";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@/components/ThemeProvider";
import { useToast } from "@/hooks/use-toast";
import axios from "axios";

const username = import.meta.env.VITE_ZABBIX_USERNAME;
const password = import.meta.env.VITE_ZABBIX_PASSWORD;

const Login = () => {
  const navigate = useNavigate();
  const { state, login } = useAuthContext();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const [isSubmitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });

  // Redirect if already logged in
  useEffect(() => {
    if (state.userToken && !state.isLoading) {
      navigate("/dashboard");
    }
  }, [state.userToken, state.isLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    if (!form.email || !form.password) {
      toast({
        title: "Validation Error",
        description: "Please fill all fields",
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    try {
      await login(form.email, form.password);

      // Login to Zabbix - Clear any existing auth first
      try {
        localStorage.removeItem("zabbixAuth"); // Clear old token before login
        
        const zabbix = await axios.post(
          "https://monitoring.liquidtelecom.net/api_jsonrpc.php",
          {
            jsonrpc: "2.0",
            method: "user.login",
            params: {
              username: username,
              password: password,
            },
            id: 1,
          },
          {
            headers: { "Content-Type": "application/json", Authorization: undefined, },
          }
        );
        console.log(zabbix);
        if (zabbix.data.result) {
          localStorage.setItem("zabbixAuth", zabbix.data.result);
        }
      } catch (zabbixError) {
        console.error("Zabbix login failed:", zabbixError);
      }

      toast({
        title: "Welcome!",
        description: "Login successful",
      });

      navigate("/dashboard");
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Login Failed",
        description: error.message || "Please check your credentials.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  // Show loading if checking auth state
  if (state.isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 sm:px-6 relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-primary/20 via-transparent to-transparent rounded-full blur-3xl" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-primary/10 via-transparent to-transparent rounded-full blur-3xl" />
      </div>

      {/* Theme Toggle */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        className="absolute top-4 right-4 h-10 w-10 rounded-full bg-card border border-border hover:bg-accent transition-all"
      >
        <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      </Button>

      <div className="w-full max-w-sm sm:max-w-md relative z-10">
        <Card className="shadow-xl border border-border bg-card/95 backdrop-blur-sm rounded-2xl overflow-hidden">
          {/* Gradient Top Border */}
          <div className="h-1 w-full bg-gradient-to-r from-primary via-primary-glow to-primary" />
          
          <CardHeader className="text-center space-y-4 pt-8 pb-2">
            {/* Logo */}
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                <Network className="w-8 h-8 text-primary" />
              </div>
            </div>
            <div>
              <CardTitle className="text-2xl font-bold text-foreground">
                Welcome back
              </CardTitle>
              <CardDescription className="text-muted-foreground mt-2">
                Sign in to access DIA Network Dashboard
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="px-6 pb-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label
                  htmlFor="email"
                  className="text-sm font-medium text-foreground"
                >
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="h-12 rounded-xl bg-background border-border focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="password"
                  className="text-sm font-medium text-foreground"
                >
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  className="h-12 rounded-xl bg-background border-border focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  required
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Checkbox id="remember-me" className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary" />
                  <Label
                    htmlFor="remember-me"
                    className="text-sm text-muted-foreground cursor-pointer"
                  >
                    Remember me
                  </Label>
                </div>
                <button
                  type="button"
                  className="text-sm text-primary hover:text-primary/80 transition-colors"
                >
                  Forgot password?
                </button>
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-all duration-200 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>

            <div className="mt-8 pt-6 border-t border-border text-center">
              <p className="text-sm text-muted-foreground">
                DIA Network Management System
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                © 2024 All rights reserved
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
