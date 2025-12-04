// Update this page (the content is just a fallback if you fail to update the page)

// This page is no longer used - redirecting users to main dashboard
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const Index = () => {
  const navigate = useNavigate();
  
  useEffect(() => {
    navigate("/");
  }, [navigate]);

  return null;
};

export default Index;
