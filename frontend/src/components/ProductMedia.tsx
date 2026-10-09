import { useEffect, useState } from "react";

interface ProductMediaProps {
  name: string;
  imageUrl: string | null;
}

function ProductMedia({ name, imageUrl }: ProductMediaProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [imageUrl]);

  const fallback = name.trim().charAt(0).toLocaleUpperCase() || "?";
  return (
    <div className="product-media">
      {imageUrl && !imageFailed ? (
        <img
          src={imageUrl}
          alt={name}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span aria-label={`อักษรย่อ ${fallback}`}>{fallback}</span>
      )}
    </div>
  );
}

export default ProductMedia;
