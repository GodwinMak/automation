import { View, Text, TouchableOpacity } from "react-native";
import React from "react";


export default function CustomButton({
  title,
  handlePress,
  containerStyles,
  textStyles,
  isLoading,
}: {
  title: string;
  handlePress: () => void;
  containerStyles?: string;
  textStyles?: string;
  isLoading?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      className={`
        bg-blue-900 rounded-xl min-h-[62px] justify-center items-center 
        ${containerStyles}
        ${isLoading ? "opacity-50": ""}
        `}
        disabled= {isLoading}
    >
      <Text className={`text-white font-spaceMono font-bold text-lg ${textStyles}`}>
        {title}
      </Text>
    </TouchableOpacity>
  );
}