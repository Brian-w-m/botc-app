import Image from "next/image";

type RoleSpriteProps = {
  roleName: string;
  size?: number;
  className?: string;
};

const spriteFiles: Record<string, string> = {
  "Fortune Teller": "Icon_Fortune+Teller.webp",
  "Scarlet Woman": "Icon_Scarlet+Woman.webp",
};

export default function RoleSprite({
  roleName,
  size = 56,
  className = "",
}: RoleSpriteProps) {
  const fileName =
    spriteFiles[roleName] ?? `Icon_${roleName.replaceAll(" ", "+")}.webp`;

  return (
    <Image
      src={`/sprites/${fileName}`}
      alt={`${roleName} character token`}
      width={size}
      height={size}
      unoptimized
      className={className}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
