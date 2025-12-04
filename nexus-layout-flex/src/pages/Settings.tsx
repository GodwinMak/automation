import React, { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Settings as SettingsIcon, Shield, Loader2 } from "lucide-react";
import axios from "axios";
import { useAuthContext } from "@/hooks/useAuthContext";
import { PRODUCTION_URL } from "@/utils/Api";
import { useNavigate } from "react-router-dom";

export default function Settings() {
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem("userData"));
  const { dispatch } = useAuthContext();

  const [userDetails, setUserDetails] = useState({
    full_name: user.username || "",
    email: user.email || "",
    password: "",
  });

  const [secrety, setSecrety] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [loadingUser, setLoadingUser] = useState(false);
  const [loadingPass, setLoadingPass] = useState(false);
  // 1. Add state for password mismatch error
  const [passwordMismatchError, setPasswordMismatchError] = useState(false);

  // ✅ Detect if user details changed
  const isUserChanged = useMemo(() => {
    return (
      userDetails.full_name !== user?.full_name ||
      userDetails.email !== user?.email 
    );
  }, [userDetails, user]);

  // ✅ Detect if password form changed
  const isPassChanged = useMemo(() => {
    const isFilled = (
      secrety.currentPassword.trim() !== "" &&
      secrety.newPassword.trim() !== "" &&
      secrety.confirmPassword.trim() !== ""
    );
    const passwordsMatch = secrety.newPassword === secrety.confirmPassword;

    // The form is valid only if all fields are filled AND passwords match
    return isFilled && passwordsMatch;
  }, [secrety]);

  const handleChangeUserDetails = (e) => {
    setUserDetails({ ...userDetails, [e.target.name]: e.target.value });
  };

  const handleChangeSecrety = (e) => {
    const { name, value } = e.target;
    const updatedSecrety = { ...secrety, [name]: value };
    
    setSecrety(updatedSecrety);

    // 2. Check for mismatch and update error state
    if (name === "newPassword" || name === "confirmPassword") {
      const newPassword = name === "newPassword" ? value : updatedSecrety.newPassword;
      const confirmPassword = name === "confirmPassword" ? value : updatedSecrety.confirmPassword;

      if (newPassword && confirmPassword && newPassword !== confirmPassword) {
        setPasswordMismatchError(true);
      } else {
        setPasswordMismatchError(false);
      }
    }
  };

  const handleSubmitUserDetails = async (e) => {
    e.preventDefault();
    if (!isUserChanged) return;
    try {
      setLoadingUser(true);
      const res = await axios.put(
        `${PRODUCTION_URL}/user/${user.id}`,
        userDetails
      );
      localStorage.setItem("userData", JSON.stringify(res.data.user));
      dispatch({ type: "SIGN_IN_TOKEN", payload: res.data.token });
    } catch (error) {
      console.log(error.response.data.message);
    } finally {
      setLoadingUser(false);
    }
  };

  const handleSubmitSecrety = async (e) => {
    e.preventDefault();
    // Also check for explicit mismatch error before submitting
    if (!isPassChanged || passwordMismatchError) return; 

    try {
      setLoadingPass(true);
      await axios.put(`${PRODUCTION_URL}/users/${user.id}`, {
        password: secrety.newPassword,
      });
      alert("Password Update is Done");

      localStorage.removeItem("userToken");
      localStorage.removeItem("userData");
      // dispatch({ type: "SIGN_OUT" });
      navigate("/");
      // reset fields
      setSecrety({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } finally {
      setLoadingPass(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account preferences and application settings
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Account Settings (omitted for brevity) */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SettingsIcon className="h-5 w-5" />
              Account Settings
            </CardTitle>
            <CardDescription>Update your account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Display Name</Label>
              <Input
                id="name"
                name="full_name"
                value={userDetails.full_name}
                onChange={handleChangeUserDetails}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={userDetails.email}
                onChange={handleChangeUserDetails}
              />
            </div>
            <Button
              className="w-full"
              onClick={handleSubmitUserDetails}
              disabled={!isUserChanged || loadingUser}
            >
              {loadingUser && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </CardContent>
        </Card>

        {/* Security */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Security
            </CardTitle>
            <CardDescription>Manage your security preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <Input
                id="current-password"
                name="currentPassword"
                type="password"
                value={secrety.currentPassword}
                onChange={handleChangeSecrety}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                name="newPassword"
                type="password"
                value={secrety.newPassword}
                onChange={handleChangeSecrety}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                value={secrety.confirmPassword}
                onChange={handleChangeSecrety}
                // Optional: add a class to visually indicate error
                className={passwordMismatchError ? "border-red-500" : ""} 
              />
              {/* 3. Conditional error message */}
              {passwordMismatchError && (
                <p className="text-sm text-red-500">
                  New password and confirmation password do not match.
                </p>
              )}
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={handleSubmitSecrety}
              // Disable if passwords don't match (already handled by isPassChanged, but explicit is clearer)
              disabled={!isPassChanged || loadingPass || passwordMismatchError}
            >
              {loadingPass && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Password
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}